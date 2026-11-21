import { useEffect, useRef, useState } from 'react';
import { Camera, Trash, Eraser, Barcode, X } from '@phosphor-icons/react';
import { api, ApiError } from '../lib/api';
import { Button } from './ui';

/** Shrink a phone photo before upload: ≤1600 px, JPEG ~0.8. Also strips location metadata. */
export async function compressImage(file: File, max = 1600, quality = 0.8): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error('That file isn’t an image we can read.');
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Couldn’t compress the photo.'))), 'image/jpeg', quality));
}

type Purpose = 'survey_photo' | 'install_photo' | 'ticket_photo';

/** Take or pick photos; each is compressed and uploaded straight away. */
export function PhotoInput({ purpose, value, onChange, min = 0, max = 12, error }: { purpose: Purpose; value: number[]; onChange: (ids: number[]) => void; min?: number; max?: number; error?: string }) {
  const [busy, setBusy] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setMsg(null);
    const list = Array.from(files).slice(0, max - value.length);
    setBusy(list.length);
    const ids: number[] = [];
    for (const f of list) {
      try {
        const blob = await compressImage(f);
        const r = await api.upload<{ id: number }>(`/api/files?purpose=${purpose}`, blob);
        ids.push(r.id);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : 'Upload failed.');
      }
      setBusy((b) => b - 1);
    }
    onChange([...value, ...ids]);
    if (input.current) input.current.value = '';
  };
  return (
    <div className="field">
      <div className="thumbs">
        {value.map((id) => (
          <div className="thumb" key={id}>
            <img src={`/api/files/${id}`} alt="Uploaded site photo" />
            <button type="button" aria-label="Remove photo" onClick={() => onChange(value.filter((x) => x !== id))}>
              <Trash size={14} />
            </button>
          </div>
        ))}
        {Array.from({ length: busy }, (_, i) => (
          <div className="thumb" key={`b${i}`}>
            <div className="skeleton" style={{ width: '100%', height: '100%' }} />
          </div>
        ))}
        {value.length < max && (
          <label className="thumb add">
            <Camera size={22} aria-hidden />
            Add photo
            <input ref={input} type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={(e) => void add(e.target.files)} />
          </label>
        )}
      </div>
      <span className="field-hint">
        {value.length} added{min ? `, at least ${min} needed` : ''}. Photos are shrunk on your phone before upload.
      </span>
      {(error || msg) && (
        <span className="field-error" role="alert">
          {error ?? msg}
        </span>
      )}
    </div>
  );
}

/** Sign on the screen with a finger or stylus. Saves a PNG and returns its file id. */
export function SignaturePad({ value, onChange, error }: { value: number | null; onChange: (id: number | null) => void; error?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const last = useRef<[number, number] | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const c = canvas.current!;
    const fit = () => {
      const r = c.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = r.width * dpr;
      c.height = r.height * dpr;
      const ctx = c.getContext('2d')!;
      ctx.scale(dpr, dpr);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = '#0e1a2b';
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const point = (e: React.PointerEvent): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const save = async () => {
    if (!dirty.current) return;
    setSaving(true);
    setMsg(null);
    try {
      const blob: Blob = await new Promise((res, rej) => canvas.current!.toBlob((b) => (b ? res(b) : rej(new Error('blank'))), 'image/png'));
      const r = await api.upload<{ id: number }>('/api/files?purpose=signature', blob);
      onChange(r.id);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'The signature didn’t save. Try again.');
    } finally {
      setSaving(false);
    }
  };
  const clear = () => {
    const c = canvas.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    dirty.current = false;
    onChange(null);
  };
  return (
    <div className="field">
      <div className="sigpad">
        <canvas
          ref={canvas}
          aria-label="Signature area. Sign with your finger."
          role="img"
          onPointerDown={(e) => {
            drawing.current = true;
            last.current = point(e);
            (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!drawing.current || !last.current) return;
            const ctx = canvas.current!.getContext('2d')!;
            const p = point(e);
            ctx.beginPath();
            ctx.moveTo(last.current[0], last.current[1]);
            ctx.lineTo(p[0], p[1]);
            ctx.stroke();
            last.current = p;
            dirty.current = true;
          }}
          onPointerUp={() => {
            drawing.current = false;
            last.current = null;
            void save();
          }}
        />
        <div className="sig-line" />
        <div className="sig-hint">{value ? 'Signed. Clear to sign again.' : saving ? 'Saving…' : 'Homeowner signs here'}</div>
      </div>
      <div className="row">
        <Button size="sm" variant="ghost" onClick={clear} icon={<Eraser size={16} />}>
          Clear
        </Button>
      </div>
      {(error || msg) && (
        <span className="field-error" role="alert">
          {error ?? msg}
        </span>
      )}
    </div>
  );
}

/**
 * Scan barcodes or QR codes with the phone camera. Uses the browser's BarcodeDetector where it exists,
 * otherwise loads a small decoder on demand. Warehouse scanners that type into the field also work.
 */
export function CameraScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let stop = false;
    let lastCode = '';
    let lastAt = 0;
    const emit = (code: string) => {
      const now = Date.now();
      if (code === lastCode && now - lastAt < 2500) return;
      lastCode = code;
      lastAt = now;
      navigator.vibrate?.(40);
      onCode(code.trim().toUpperCase());
    };
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const Detector = (window as unknown as { BarcodeDetector?: new (o: object) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
        if (Detector) {
          const det = new Detector({ formats: ['code_128', 'code_39', 'qr_code', 'ean_13', 'data_matrix'] });
          const tick = async () => {
            if (stop || !video.current) return;
            try {
              const found = await det.detect(video.current);
              if (found[0]?.rawValue) emit(found[0].rawValue);
            } catch {
              /* frame not ready */
            }
            window.setTimeout(tick, 250);
          };
          void tick();
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          const reader = new BrowserMultiFormatReader();
          const controls = await reader.decodeFromVideoElement(video.current, (res) => res && emit(res.getText()));
          const prevStop = () => controls.stop();
          const check = window.setInterval(() => stop && (prevStop(), clearInterval(check)), 300);
        }
      } catch {
        setError('Camera not available. Allow camera access, or type the serial instead.');
      }
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);
  return (
    <div className="stack">
      <div className="scanner">
        <video ref={video} muted playsInline aria-label="Camera view for scanning" />
        <div className="reticle" aria-hidden />
        <div className="beam" aria-hidden />
      </div>
      {error && <p className="field-error">{error}</p>}
      <div className="row between">
        <span className="muted">
          <Barcode size={16} style={{ verticalAlign: '-3px' }} /> Point at the serial barcode or QR label
        </span>
        <Button size="sm" onClick={onClose} icon={<X size={14} />}>
          Close camera
        </Button>
      </div>
    </div>
  );
}
