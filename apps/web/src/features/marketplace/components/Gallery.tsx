import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Images, X } from 'lucide-react';
import type { ImageDto } from '@stayscape/shared';
import { useFocusTrap, useScrollLock } from '@/hooks/overlay';
import { cn } from '@/lib/cn';
import { ResponsiveImage } from './HotelCard';
import { tr, trf } from '@/lib/tr';

/** Full-screen gallery: ←/→ to navigate, Home/End, Escape to close; focus is trapped and restored. */
export function Lightbox({
  images,
  index,
  onIndex,
  onClose,
  title,
}: {
  images: ImageDto[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  title: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true);
  useScrollLock(true);
  const go = useCallback(
    (delta: number) => onIndex((index + delta + images.length) % images.length),
    [index, images.length, onIndex],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'Home') onIndex(0);
      else if (e.key === 'End') onIndex(images.length - 1);
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [go, onClose, onIndex, images.length]);

  const image = images[index];
  if (!image) return null;
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={trf('{0} photos', [title])}
      className="fixed inset-0 z-[70] flex flex-col bg-black/95 text-white"
      tabIndex={-1}
    >
      <div className="flex items-center justify-between p-4">
        <p className="text-sm" aria-live="polite">
          {tr('Photo')} {index + 1} {tr('of')} {images.length}
          {image.alt && <span className="text-white/70"> — {image.alt}</span>}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-2 hover:bg-white/10"
          aria-label={tr('Close gallery')}
        >
          <X className="size-6" aria-hidden="true" />
        </button>
      </div>
      <div className="relative flex flex-1 items-center justify-center px-4 pb-4">
        <ResponsiveImage
          image={image}
          sizes="100vw"
          eager
          className="max-h-full max-w-full object-contain"
        />
        {images.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              className="absolute left-4 rounded-full bg-white/10 p-3 hover:bg-white/20"
              aria-label={tr('Previous photo')}
            >
              <ChevronLeft className="size-6" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              className="absolute right-4 rounded-full bg-white/10 p-3 hover:bg-white/20"
              aria-label={tr('Next photo')}
            >
              <ChevronRight className="size-6" aria-hidden="true" />
            </button>
          </>
        )}
      </div>
      <div
        className="relative flex gap-2 overflow-x-auto p-4"
        role="group"
        aria-label={tr('Thumbnails')}
      >
        {images.map((img, i) => (
          <button
            key={img.id}
            type="button"
            onClick={() => onIndex(i)}
            aria-label={trf('Show photo {0}', [i + 1])}
            aria-current={i === index}
            className={cn(
              'h-16 w-24 shrink-0 overflow-hidden rounded-md border-2',
              i === index ? 'border-gold-400' : 'border-transparent opacity-60 hover:opacity-100',
            )}
          >
            <img src={img.variants.sm} alt="" loading="lazy" className="size-full object-cover" />
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

export function PhotoGrid({ images, title }: { images: ImageDto[]; title: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (images.length === 0)
    return (
      <div className="flex aspect-[16/7] items-center justify-center rounded-3xl bg-surface-muted text-fg-subtle">
        {tr('No photos yet')}
      </div>
    );
  const [first, ...rest] = images;
  return (
    <div className="relative">
      <div
        className="grid gap-2 overflow-hidden rounded-3xl sm:grid-cols-4 sm:grid-rows-2"
        style={{ aspectRatio: '16 / 7' }}
      >
        <button
          type="button"
          onClick={() => setOpen(0)}
          className="relative sm:col-span-2 sm:row-span-2"
          aria-label={trf('Open photo 1 of {0}', [images.length])}
        >
          <ResponsiveImage
            image={first!}
            sizes="(min-width: 640px) 50vw, 100vw"
            eager
            className="size-full"
          />
        </button>
        {rest.slice(0, 4).map((img, i) => (
          <button
            key={img.id}
            type="button"
            onClick={() => setOpen(i + 1)}
            className="relative hidden sm:block"
            aria-label={trf('Open photo {0} of {1}', [i + 2, images.length])}
          >
            <ResponsiveImage image={img} sizes="25vw" className="size-full" />
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setOpen(0)}
        className="absolute right-4 bottom-4 inline-flex items-center gap-2 rounded-full bg-surface/95 px-4 py-2 text-sm font-medium shadow-md hover:bg-surface"
      >
        <Images className="size-4" aria-hidden="true" /> {tr('View all')} {images.length}{' '}
        {tr('photos')}
      </button>
      {open !== null && (
        <Lightbox
          images={images}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
          title={title}
        />
      )}
    </div>
  );
}
