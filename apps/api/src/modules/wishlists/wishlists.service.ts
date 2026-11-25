import { createHash, randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import {
  MAX_WISHLISTS,
  MAX_WISHLIST_ITEMS,
  type HotelCardDto,
  type HotelPriceDto,
  type SharedWishlistDto,
  type WishlistDetailDto,
  type WishlistSummaryDto,
} from '@stayscape/shared';
import type { Config } from '@/config/env';
import { AppError, Errors, isMongoDuplicateKey } from '@/lib/errors';
import type { FieldEncryptor } from '@/lib/field-encryption';
import { HotelModel, type HotelRecord } from '@/modules/hotels/hotel.model';
import type { QuoteService } from '@/modules/pricing/quote.service';
import { CARD_PROJECTION, type SearchService } from '@/modules/search/search.service';
import { UserModel } from '@/modules/users/user.model';
import { WishlistModel, type WishlistRecord } from './wishlist.model';

const DEFAULT_NAME = 'Saved stays';
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

interface Deps {
  config: Pick<Config, 'WEB_APP_URL'>;
  search: SearchService;
  quotes: QuoteService;
  encryptor: FieldEncryptor;
}

/**
 * Wishlists. Every query is scoped by `userId` (other users' lists read as 404). Shared lists are
 * reachable only through an unguessable 256-bit token; the public view exposes the list name, the
 * owner's first name and published hotel cards — never notes, user ids or unpublished hotels.
 */
export class WishlistsService {
  constructor(private readonly deps: Deps) {}

  private async owned(userId: string, id: string): Promise<WishlistRecord> {
    if (!Types.ObjectId.isValid(id)) throw Errors.notFound('Wishlist');
    const list = await WishlistModel.findOne({ _id: id, userId }).lean<WishlistRecord>();
    if (!list) throw Errors.notFound('Wishlist');
    return list;
  }

  private async publishedCards(
    hotelIds: Types.ObjectId[],
  ): Promise<Map<string, { hotel: HotelRecord; card: HotelCardDto }>> {
    const hotels = await HotelModel.find(
      { _id: { $in: hotelIds }, publicationStatus: 'PUBLISHED' },
      CARD_PROJECTION,
    ).lean<HotelRecord[]>();
    const cards = await this.deps.search.cards(hotels);
    return new Map(hotels.map((h, i) => [h._id.toString(), { hotel: h, card: cards[i]! }]));
  }

  private shareUrl(list: WishlistRecord): string | null {
    if (!list.shareTokenEncrypted) return null;
    return new URL(
      `/wishlists/shared/${this.deps.encryptor.decrypt(list.shareTokenEncrypted)}`,
      this.deps.config.WEB_APP_URL,
    ).toString();
  }

  private summary(list: WishlistRecord, cover: HotelCardDto | undefined): WishlistSummaryDto {
    return {
      id: list._id.toString(),
      name: list.name,
      isDefault: list.isDefault,
      itemCount: list.items.length,
      shared: Boolean(list.shareTokenHash),
      coverImage: cover?.coverImage ?? null,
      updatedAt: list.updatedAt.toISOString(),
    };
  }

  async ensureDefault(userId: string): Promise<WishlistRecord> {
    const existing = await WishlistModel.findOne({
      userId,
      isDefault: true,
    }).lean<WishlistRecord>();
    if (existing) return existing;
    try {
      return (
        await WishlistModel.create({ userId, name: DEFAULT_NAME, isDefault: true })
      ).toObject() as WishlistRecord;
    } catch (error) {
      if (!isMongoDuplicateKey(error)) throw error;
      return (await WishlistModel.findOne({ userId, isDefault: true }).lean<WishlistRecord>())!;
    }
  }

  async list(userId: string): Promise<WishlistSummaryDto[]> {
    await this.ensureDefault(userId);
    const lists = await WishlistModel.find({ userId })
      .sort({ isDefault: -1, updatedAt: -1 })
      .lean<WishlistRecord[]>();
    const firstIds = lists.flatMap((l) => (l.items[0] ? [l.items[0].hotelId] : []));
    const cards = await this.publishedCards(firstIds);
    return lists.map((l) =>
      this.summary(l, l.items[0] ? cards.get(l.items[0].hotelId.toString())?.card : undefined),
    );
  }

  async create(userId: string, name: string): Promise<WishlistSummaryDto> {
    if ((await WishlistModel.countDocuments({ userId })) >= MAX_WISHLISTS)
      throw new AppError(409, 'CONFLICT', `You can have up to ${MAX_WISHLISTS} lists.`);
    const list = (
      await WishlistModel.create({ userId, name, isDefault: false })
    ).toObject() as WishlistRecord;
    return this.summary(list, undefined);
  }

  async rename(userId: string, id: string, name: string): Promise<WishlistSummaryDto> {
    await this.owned(userId, id);
    const list = await WishlistModel.findOneAndUpdate(
      { _id: id, userId },
      { $set: { name } },
      { new: true },
    ).lean<WishlistRecord>();
    return this.summary(list!, undefined);
  }

  async remove(userId: string, id: string): Promise<void> {
    const list = await this.owned(userId, id);
    if (list.isDefault)
      throw new AppError(
        409,
        'CONFLICT',
        'Your default list cannot be deleted. Remove its stays instead.',
      );
    await WishlistModel.deleteOne({ _id: id, userId });
  }

  async detail(
    userId: string,
    id: string,
    stay: {
      checkIn?: string | undefined;
      checkOut?: string | undefined;
      adults: number;
      rooms: number;
    },
  ): Promise<WishlistDetailDto> {
    const list = await this.owned(userId, id);
    const cards = await this.publishedCards(list.items.map((i) => i.hotelId));
    let prices = new Map<string, HotelPriceDto>();
    const withDates = Boolean(stay.checkIn && stay.checkOut);
    if (withDates) {
      prices = await this.deps.quotes.cheapestOffers(
        [...cards.values()].map((c) => c.hotel),
        {
          checkIn: stay.checkIn!,
          checkOut: stay.checkOut!,
          adults: stay.adults,
          children: 0,
          childrenAges: [],
          rooms: stay.rooms,
        },
      );
    }
    const items = list.items.flatMap((item) => {
      const entry = cards.get(item.hotelId.toString());
      if (!entry) return [];
      const price = prices.get(item.hotelId.toString()) ?? null;
      return [
        {
          hotel: entry.card,
          note: item.note,
          addedAt: item.addedAt.toISOString(),
          price,
          availableForDates: withDates ? Boolean(price) : null,
        },
      ];
    });
    return {
      ...this.summary(list, items[0]?.hotel),
      shareUrl: this.shareUrl(list),
      items,
      unavailableCount: list.items.length - items.length,
    };
  }

  async saveItem(userId: string, id: string, hotelId: string, note: string): Promise<void> {
    const list = await this.owned(userId, id);
    if (
      !Types.ObjectId.isValid(hotelId) ||
      !(await HotelModel.exists({ _id: hotelId, publicationStatus: 'PUBLISHED' }))
    )
      throw Errors.notFound('Property');
    const hid = new Types.ObjectId(hotelId);
    if (list.items.some((i) => i.hotelId.equals(hid))) {
      await WishlistModel.updateOne(
        { _id: id, userId, 'items.hotelId': hid },
        { $set: { 'items.$.note': note } },
      );
      return;
    }
    if (list.items.length >= MAX_WISHLIST_ITEMS)
      throw new AppError(409, 'CONFLICT', `A list can hold up to ${MAX_WISHLIST_ITEMS} stays.`);
    // Conditional push: concurrent saves of the same hotel cannot duplicate it.
    await WishlistModel.updateOne(
      { _id: id, userId, 'items.hotelId': { $ne: hid } },
      { $push: { items: { hotelId: hid, note, addedAt: new Date() } } },
    );
  }

  async removeItem(userId: string, id: string, hotelId: string): Promise<void> {
    await this.owned(userId, id);
    if (!Types.ObjectId.isValid(hotelId)) throw Errors.notFound('Property');
    await WishlistModel.updateOne(
      { _id: id, userId },
      { $pull: { items: { hotelId: new Types.ObjectId(hotelId) } } },
    );
  }

  /** Create (or rotate) the share link. Returns the URL; the token is shown only to the owner. */
  async share(userId: string, id: string): Promise<{ shareUrl: string }> {
    await this.owned(userId, id);
    const token = randomBytes(32).toString('base64url');
    await WishlistModel.updateOne(
      { _id: id, userId },
      {
        $set: {
          shareTokenHash: hashToken(token),
          shareTokenEncrypted: this.deps.encryptor.encrypt(token),
          sharedAt: new Date(),
        },
      },
    );
    return {
      shareUrl: new URL(`/wishlists/shared/${token}`, this.deps.config.WEB_APP_URL).toString(),
    };
  }

  async unshare(userId: string, id: string): Promise<void> {
    await this.owned(userId, id);
    await WishlistModel.updateOne(
      { _id: id, userId },
      { $set: { shareTokenHash: null, shareTokenEncrypted: null, sharedAt: null } },
    );
  }

  async shared(token: string): Promise<SharedWishlistDto> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw Errors.notFound('Wishlist');
    const list = await WishlistModel.findOne({
      shareTokenHash: hashToken(token),
    }).lean<WishlistRecord>();
    if (!list) throw Errors.notFound('Wishlist');
    const owner = await UserModel.findById(list.userId, { firstName: 1 }).lean<{
      firstName: string;
    }>();
    const cards = await this.publishedCards(list.items.map((i) => i.hotelId));
    return {
      name: list.name,
      ownerFirstName: owner?.firstName ?? 'A traveller',
      items: list.items.flatMap((i) => {
        const c = cards.get(i.hotelId.toString());
        return c ? [{ hotel: c.card }] : [];
      }),
    };
  }

  // ------------------------------------------------------------------ heart button (default list)
  async savedHotelIds(userId: string): Promise<string[]> {
    const lists = await WishlistModel.find({ userId }, { items: 1 }).lean<WishlistRecord[]>();
    return [...new Set(lists.flatMap((l) => l.items.map((i) => i.hotelId.toString())))];
  }

  async saveToDefault(userId: string, hotelId: string): Promise<void> {
    const list = await this.ensureDefault(userId);
    await this.saveItem(userId, list._id.toString(), hotelId, '');
  }

  /** Un-hearting removes the stay from every list, matching what the heart shows. */
  async removeEverywhere(userId: string, hotelId: string): Promise<void> {
    if (!Types.ObjectId.isValid(hotelId)) throw Errors.notFound('Property');
    await WishlistModel.updateMany(
      { userId },
      { $pull: { items: { hotelId: new Types.ObjectId(hotelId) } } },
    );
  }

  async defaultCards(userId: string): Promise<HotelCardDto[]> {
    const list = await this.ensureDefault(userId);
    const cards = await this.publishedCards(list.items.map((i) => i.hotelId));
    return [...list.items]
      .reverse()
      .flatMap((i) =>
        cards.get(i.hotelId.toString()) ? [cards.get(i.hotelId.toString())!.card] : [],
      );
  }
}
