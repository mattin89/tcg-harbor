import { useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { Icon } from "../components/Icon";
import { storeJoinUrl } from "./storeJoinRoute";
import type { GeneratedStoreQrInvite, ManagedStore, StoreQrInvite } from "./types";
import type { ProductionAccessController } from "./useProductionAccess";

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const field = document.createElement("textarea");
  field.value = value;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  document.execCommand("copy");
  field.remove();
}

function downloadQr(container: HTMLDivElement | null, store: ManagedStore) {
  const source = container?.querySelector("svg");
  if (!source) return false;
  const svg = source.cloneNode(true) as SVGElement;
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", "1200");
  svg.setAttribute("height", "1200");
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `tcg-harbor-${store.slug || store.id}-community-qr.svg`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
  return true;
}

export function StoreQrInviteManager({ store, access }: { store: ManagedStore; access: ProductionAccessController }) {
  const [invites, setInvites] = useState<StoreQrInvite[]>([]);
  const [generated, setGenerated] = useState<GeneratedStoreQrInvite | null>(null);
  const [label, setLabel] = useState("In-store counter QR");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"generate" | "rotate" | "revoke" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const qrRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      setInvites(await access.listStoreQrInvites(store.id));
      setLocalError(null);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Join codes could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [store.id]);

  const activeInvite = invites.find((invite) => invite.isActive) ?? null;
  const joinUrl = generated ? storeJoinUrl(window.location.origin, generated.rawToken) : null;

  const copy = async (value: string, successMessage: string) => {
    try {
      await copyText(value);
      setLocalError(null);
      setNotice(successMessage);
    } catch {
      setLocalError("Your browser blocked clipboard access. Select and copy the join link manually.");
    }
  };

  const create = async () => {
    setBusy("generate");
    setNotice(null);
    setLocalError(null);
    try {
      const next = await access.generateStoreQrInvite(store.id, label);
      setGenerated(next);
      setNotice("QR created. Download or copy it now; the raw token cannot be recovered after you leave this page.");
      await load();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "The QR could not be generated.");
    } finally {
      setBusy(null);
    }
  };

  const rotate = async () => {
    if (!window.confirm("Rotate this store QR? The currently printed code will stop working immediately.")) return;
    setBusy("rotate");
    setNotice(null);
    setLocalError(null);
    try {
      const next = await access.rotateStoreQrInvite(store.id, label);
      setGenerated(next);
      setNotice("Previous QR revoked and replacement generated atomically. Replace every printed copy.");
      await load();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "The QR could not be rotated.");
    } finally {
      setBusy(null);
    }
  };

  const revoke = async () => {
    if (!window.confirm("Revoke the active QR? Players will not be able to join until you generate a replacement.")) return;
    setBusy("revoke");
    setNotice(null);
    setLocalError(null);
    try {
      await access.revokeStoreQrInvite(store.id, "Revoked from the store workspace");
      setGenerated(null);
      setNotice("Active QR revoked. Existing community members keep their membership.");
      await load();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "The QR could not be revoked.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="production-qr-manager">
      <header>
        <div><h4>Physical store QR</h4><p>Players scan this poster in store to join {store.community?.name ?? "the community"}.</p></div>
        {activeInvite && <span className="production-live-pill"><i />Active</span>}
      </header>

      {loading ? <div className="production-channel-loading" aria-busy="true" /> : <>
        <div className="production-qr-layout">
          <div className="production-qr-canvas" ref={qrRef}>
            {joinUrl ? <QRCode value={joinUrl} size={216} level="H" bgColor="#fffaf1" fgColor="#091827" title={`${store.name} community join QR`} /> : <span><Icon name="qr" size={48} /><small>{activeInvite ? "Rotate to reveal a new printable QR" : "Generate the first store QR"}</small></span>}
          </div>
          <div className="production-qr-controls">
            <label className="production-field"><span>Poster label</span><input value={label} maxLength={120} onChange={(event) => setLabel(event.target.value)} /></label>
            {generated && joinUrl ? <>
              <label className="production-field"><span>Join link <small>Raw token shown once</small></span><input value={joinUrl} readOnly /></label>
              <div className="production-qr-actions">
                <button className="production-secondary" type="button" onClick={() => void copy(joinUrl, "Join link copied.")}><Icon name="copy" size={15} />Copy link</button>
                <button className="production-secondary" type="button" onClick={() => void copy(generated.rawToken, "Raw join token copied.")}><Icon name="copy" size={15} />Copy token</button>
                <button className="production-secondary" type="button" onClick={() => { if (downloadQr(qrRef.current, store)) setNotice("Print-quality SVG downloaded."); }}><Icon name="download" size={15} />Download SVG</button>
              </div>
            </> : activeInvite ? <div className="production-qr-summary">
              <span><strong>{activeInvite.tokenPrefix}…</strong><small>Created {new Date(activeInvite.createdAt).toLocaleDateString()} · {activeInvite.useCount} successful {activeInvite.useCount === 1 ? "join" : "joins"}</small></span>
              <p><Icon name="lock" size={15} />For security, an existing raw token is not recoverable. Rotate it to receive a replacement QR.</p>
            </div> : <p className="production-qr-empty">No active invitation exists for this physical location.</p>}
            <div className="production-qr-actions">
              {!activeInvite && <button className="production-primary" type="button" disabled={Boolean(busy)} onClick={() => void create()}><Icon name="qr" size={16} />{busy === "generate" ? "Generating…" : "Generate QR"}</button>}
              {activeInvite && <button className="production-primary" type="button" disabled={Boolean(busy)} onClick={() => void rotate()}><Icon name="refresh" size={16} />{busy === "rotate" ? "Rotating…" : "Rotate QR"}</button>}
              {activeInvite && <button className="production-reject" type="button" disabled={Boolean(busy)} onClick={() => void revoke()}><Icon name="lock" size={16} />{busy === "revoke" ? "Revoking…" : "Revoke"}</button>}
            </div>
          </div>
        </div>
        {notice && <p className="production-notice production-notice-success" role="status"><Icon name="check" size={16} />{notice}</p>}
        {localError && <p className="production-notice production-notice-error" role="alert"><Icon name="info" size={16} />{localError}</p>}
      </>}
    </section>
  );
}
