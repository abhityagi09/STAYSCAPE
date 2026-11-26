import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type DragEvent,
  type FormEvent,
} from 'react';
import { ImagePlus, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';
import { controlClasses } from './Field';
import { tr, trf } from '@/lib/tr';

/* ---------------------------------------------------------------- SearchInput */
export interface SearchInputProps extends Omit<
  ComponentProps<'input'>,
  'type' | 'onChange' | 'value' | 'onSubmit'
> {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  onSearch?: (value: string) => void;
  containerClassName?: string;
}

export function SearchInput({
  label,
  value,
  onValueChange,
  onSearch,
  placeholder = 'Search',
  containerClassName,
  className,
  ...props
}: SearchInputProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSearch?.(value);
  };
  return (
    <form role="search" onSubmit={submit} className={cn('relative', containerClassName)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search
        className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-fg-subtle"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        id={id}
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onValueChange(event.target.value)}
        className={cn(
          controlClasses,
          'pr-10 pl-10 [&::-webkit-search-cancel-button]:hidden',
          className,
        )}
        {...props}
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            onValueChange('');
            onSearch?.('');
            inputRef.current?.focus();
          }}
          className="absolute top-1/2 right-2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-fg-subtle hover:bg-surface-muted hover:text-fg"
          aria-label={tr('Clear search')}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
    </form>
  );
}

/* ---------------------------------------------------------------- ImageUploader */
export interface ImageUploaderProps {
  label: string;
  /** Current persisted image URL, if any. */
  currentUrl?: string | null;
  accept?: readonly string[];
  maxBytes: number;
  onUpload: (file: File) => Promise<unknown>;
  uploading?: boolean;
  hint?: string;
}

const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(0)} MB`
    : `${Math.round(bytes / 1024)} KB`;

/**
 * Drag-and-drop or click-to-browse image picker with client-side pre-validation.
 * The server re-validates size and inspects file content; client checks are for UX only.
 */
export function ImageUploader({
  label,
  currentUrl,
  accept = ['image/jpeg', 'image/png', 'image/webp'],
  maxBytes,
  onUpload,
  uploading,
  hint,
}: ImageUploaderProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const handleFile = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!accept.includes(file.type)) {
      setError('Choose a JPEG, PNG or WebP image.');
      return;
    }
    if (file.size > maxBytes) {
      setError(`Images must be ${formatBytes(maxBytes)} or smaller.`);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    try {
      await onUpload(file);
    } catch (uploadError) {
      setPreview(null);
      setError(
        uploadError instanceof Error ? uploadError.message : 'Upload failed. Please try again.',
      );
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void handleFile(event.dataTransfer.files[0]);
  };

  const shown = preview ?? currentUrl ?? null;

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-fg" id={`${inputId}-label`}>
        {label}
      </span>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed p-5 transition-colors sm:flex-row',
          dragging ? 'border-primary bg-primary-soft' : 'border-border-strong',
        )}
      >
        <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-muted text-fg-subtle">
          {shown ? (
            <img src={shown} alt="Current avatar preview" className="size-full object-cover" />
          ) : (
            <ImagePlus className="size-7" aria-hidden="true" />
          )}
        </div>
        <div className="flex flex-1 flex-col items-center gap-2 text-center sm:items-start sm:text-left">
          <p className="text-sm text-fg-muted">{tr('Drag an image here, or')}</p>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={accept.join(',')}
            className="sr-only"
            aria-labelledby={`${inputId}-label`}
            aria-describedby={`${inputId}-hint`}
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          <Button
            variant="outline"
            size="sm"
            loading={uploading}
            loadingText="Uploading…"
            onClick={() => inputRef.current?.click()}
          >
            {tr('Choose image')}
          </Button>
          <p id={`${inputId}-hint`} className="text-xs text-fg-subtle">
            {hint ?? trf('JPEG, PNG or WebP, up to {0}.', [formatBytes(maxBytes)])}
          </p>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
