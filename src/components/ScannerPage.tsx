import { useEffect, useRef, useState, type FormEvent } from 'react';
import { stores } from '../data/demo';
import { Icon } from './Icon';
import { Button, Chip, DemoBadge } from './ui';

interface ScannerPageProps {
  navigate: (path: string) => void;
  notify: (message: string) => void;
}

function codeFromPayload(payload: string): string {
  const value = payload.trim();
  try {
    const url = new URL(value, window.location.origin);
    const match = url.pathname.match(/\/join\/([^/?#]+)/i);
    return match ? decodeURIComponent(match[1]) : value;
  } catch {
    return value;
  }
}

export function ScannerPage({ navigate, notify }: ScannerPageProps) {
  const [cameraState, setCameraState] = useState<'idle' | 'requesting' | 'active' | 'denied'>('idle');
  const [manual, setManual] = useState('');
  const [uploaded, setUploaded] = useState('');
  const [uploadResult, setUploadResult] = useState('');
  const [uploadError, setUploadError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerControlsRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => () => scannerControlsRef.current?.stop(), []);

  const acceptDecodedPayload = (payload: string) => {
    const code = codeFromPayload(payload);
    scannerControlsRef.current?.stop();
    notify('Store QR detected — validating its revocable join token');
    navigate(`/join/${encodeURIComponent(code)}`);
  };

  const startCamera = async () => {
    setCameraState('requesting');
    try {
      if (!videoRef.current) throw new Error('Camera preview unavailable');
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      const reader = new BrowserQRCodeReader(undefined, {
        delayBetweenScanAttempts: 250,
        delayBetweenScanSuccess: 800,
      });
      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } }, audio: false },
        videoRef.current,
        (result) => {
          if (result) acceptDecodedPayload(result.getText());
        },
      );
      scannerControlsRef.current = controls;
      setCameraState('active');
      notify('Camera ready — align the store code inside the frame');
    } catch {
      setCameraState('denied');
    }
  };

  const decodeUpload = async (file: File) => {
    setUploaded(file.name);
    setUploadResult('');
    setUploadError('');
    const objectUrl = URL.createObjectURL(file);
    try {
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      const result = await new BrowserQRCodeReader().decodeFromImageUrl(objectUrl);
      const decoded = codeFromPayload(result.getText());
      setUploadResult(decoded);
      notify('QR code decoded from the uploaded image');
    } catch {
      setUploadError('No readable QR was found. Try a sharper, well-lit image or enter the code manually.');
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  };

  const submitManual = (event: FormEvent) => {
    event.preventDefault();
    navigate(`/join/${encodeURIComponent(manual.trim().toUpperCase())}`);
  };

  return <div className="page scanner-page">
    <button className="back-link" onClick={() => navigate('/stores')}><Icon name="chevron" />Back to stores</button>
    <div className="scanner-layout">
      <section className="scanner-card panel">
        <div className="panel-header"><div><p className="eyebrow">Physical verification</p><h2>Scan the store’s QR</h2></div><Chip tone="positive"><Icon name="shield" size={13} />Secure join</Chip></div>
        <div className={`camera-view camera-${cameraState}`}>
          <video ref={videoRef} muted playsInline />
          <div className="scan-frame"><i /><i /><i /><i /></div>
          {cameraState === 'idle' && <div className="camera-placeholder"><span><Icon name="camera" size={34} /></span><strong>Camera access starts only when you ask</strong><p>We use the camera only to detect a store QR code. No image is stored.</p><Button onClick={startCamera} icon="camera">Enable camera</Button></div>}
          {cameraState === 'requesting' && <div className="camera-placeholder"><span className="spinner" /><strong>Waiting for camera permission…</strong></div>}
          {cameraState === 'denied' && <div className="camera-placeholder denied"><span><Icon name="camera" size={34} /></span><strong>Camera permission denied</strong><p>Allow camera access in browser settings, upload a QR image, or enter the code manually.</p><Button variant="secondary" onClick={startCamera} icon="refresh">Try again</Button></div>}
          {cameraState === 'active' && <div className="scan-status"><span className="live-pulse" />Looking for a TCG Harbor code…</div>}
        </div>
        <p className="scanner-safety"><Icon name="lock" />Codes contain a public, revocable store token — never credentials.</p>
      </section>
      <aside className="scanner-fallbacks">
        <section className="panel">
          <span className="fallback-icon"><Icon name="upload" /></span><div><h3>Upload a QR image</h3><p>Choose a photo or screenshot of the in-store poster.</p></div>
          <label className="upload-button"><input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) void decodeUpload(file); }} />{uploaded ? 'Image loaded' : 'Choose image'}</label>
          {uploadResult && <div className="upload-result"><Icon name="check" /><span><strong>{uploaded}</strong><small>Code detected: {uploadResult}</small></span><Button size="sm" onClick={() => navigate(`/join/${encodeURIComponent(uploadResult)}`)}>Continue</Button></div>}
          {uploadError && <div className="upload-result upload-failed"><Icon name="info" /><span><strong>Could not decode image</strong><small>{uploadError}</small></span></div>}
        </section>
        <section className="panel">
          <span className="fallback-icon"><Icon name="qr" /></span><div><h3>Enter code manually</h3><p>Accessible fallback for the code printed below the QR.</p></div>
          <form onSubmit={submitManual}><label><span>Store code</span><input value={manual} onChange={(event) => setManual(event.target.value)} placeholder="HARBOR-CITY-XXXX" required /></label><Button type="submit" variant="secondary">Validate code</Button></form>
        </section>
        <section className="demo-scan panel">
          <DemoBadge compact /><h3>Development convenience</h3><p>Seeded stores include simulation links for testing. Physical scanning remains the production path.</p><Button variant="ghost" onClick={() => navigate(`/join/${stores[0].code}`)} icon="sparkle">Simulate Berlin scan</Button>
        </section>
      </aside>
    </div>
  </div>;
}
