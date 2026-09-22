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

export function buildEmbeddedQrSvg(sourceSvg: SVGElement, logoUrl?: string | null): SVGElement {
  const svg = sourceSvg.cloneNode(true) as SVGElement;
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  svg.setAttribute("width", "1200");
  svg.setAttribute("height", "1200");

  if (logoUrl) {
    const badgeSize = 280;
    const badgeX = (1200 - badgeSize) / 2;
    const badgeY = (1200 - badgeSize) / 2;
    const innerSize = 230;
    const innerX = (1200 - innerSize) / 2;
    const innerY = (1200 - innerSize) / 2;

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", String(badgeX));
    rect.setAttribute("y", String(badgeY));
    rect.setAttribute("width", String(badgeSize));
    rect.setAttribute("height", String(badgeSize));
    rect.setAttribute("rx", "32");
    rect.setAttribute("fill", "#fffaf1");
    rect.setAttribute("stroke", "#091827");
    rect.setAttribute("stroke-width", "12");
    g.appendChild(rect);

    const image = document.createElementNS("http://www.w3.org/2000/svg", "image");
    image.setAttribute("href", logoUrl);
    image.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", logoUrl);
    image.setAttribute("x", String(innerX));
    image.setAttribute("y", String(innerY));
    image.setAttribute("width", String(innerSize));
    image.setAttribute("height", String(innerSize));
    image.setAttribute("preserveAspectRatio", "xMidYMid meet");
    g.appendChild(image);

    svg.appendChild(g);
  }

  return svg;
}

function downloadQr(container: HTMLDivElement | null, store: ManagedStore, logoUrl?: string | null) {
  const source = container?.querySelector("svg");
  if (!source) return false;
  const svg = buildEmbeddedQrSvg(source, logoUrl);

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

async function downloadPng(container: HTMLDivElement | null, store: ManagedStore, logoUrl?: string | null): Promise<boolean> {
  const source = container?.querySelector("svg");
  if (!source) return false;
  const svg = buildEmbeddedQrSvg(source, logoUrl);

  const svgStr = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const img = new Image();

  return new Promise((resolve) => {
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 1200;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        resolve(false);
        return;
      }
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((pngBlob) => {
        if (!pngBlob) {
          resolve(false);
          return;
        }
        const pngUrl = URL.createObjectURL(pngBlob);
        const anchor = document.createElement("a");
        anchor.href = pngUrl;
        anchor.download = `tcg-harbor-${store.slug || store.id}-community-qr.png`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(pngUrl), 0);
        resolve(true);
      }, "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(false);
    };
    img.src = url;
  });
}

export function StoreQrInviteManager({ store, access }: { store: ManagedStore; access: ProductionAccessController }) {
  const [invites, setInvites] = useState<StoreQrInvite[]>([]);
  const [generated, setGenerated] = useState<GeneratedStoreQrInvite | null>(null);
  const [label, setLabel] = useState("In-store counter QR");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"generate" | "rotate" | "revoke" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [includeLogo, setIncludeLogo] = useState(Boolean(store.imageUrl));
  const [logoSource, setLogoSource] = useState<"store" | "custom">(store.imageUrl ? "store" : "custom");
  const [customLogoUrl, setCustomLogoUrl] = useState<string>("");
  const qrRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeLogoUrl = includeLogo
    ? (logoSource === "store" && store.imageUrl ? store.imageUrl : customLogoUrl.trim() || null)
    : null;

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

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setCustomLogoUrl(reader.result);
        setLogoSource("custom");
        setIncludeLogo(true);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <section className="production-qr-manager">
      <header>
        <div><h4>Physical store QR</h4><p>Players scan this poster in store to join {store.community?.name ?? "the community"}.</p></div>
        {activeInvite && <span className="production-live-pill"><i />Active</span>}
      </header>

      {loading ? <div className="production-channel-loading" aria-busy="true" /> : <>
        <div className="production-qr-layout">
          <div className="production-qr-canvas" ref={qrRef} style={{ position: "relative" }}>
            {joinUrl ? (
              <div style={{ position: "relative", display: "inline-block", width: 216, height: 216 }}>
                <QRCode value={joinUrl} size={216} level="H" bgColor="#fffaf1" fgColor="#091827" title={`${store.name} community join QR`} />
                {activeLogoUrl && (
                  <div
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: "50%",
                      transform: "translate(-50%, -50%)",
                      width: 52,
                      height: 52,
                      borderRadius: 10,
                      backgroundColor: "#fffaf1",
                      border: "2px solid #091827",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      overflow: "hidden",
                      padding: 4,
                      boxShadow: "0 2px 8px rgba(0, 0, 0, 0.25)",
                      pointerEvents: "none",
                    }}
                  >
                    <img
                      src={activeLogoUrl}
                      alt={`${store.name} logo`}
                      style={{ width: "100%", height: "100%", objectFit: "contain" }}
                    />
                  </div>
                )}
              </div>
            ) : (
              <span><Icon name="qr" size={48} /><small>{activeInvite ? "Rotate to reveal a new printable QR" : "Generate the first store QR"}</small></span>
            )}
          </div>
          <div className="production-qr-controls">
            <label className="production-field"><span>Poster label</span><input value={label} maxLength={120} onChange={(event) => setLabel(event.target.value)} /></label>

            {/* Logo embedding controls */}
            <div style={{ display: "grid", gap: 8, padding: "10px 12px", borderRadius: 8, background: "rgba(255, 255, 255, 0.04)", border: "1px solid rgba(255, 255, 255, 0.08)" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#dce5e3" }}>
                <input
                  type="checkbox"
                  checked={includeLogo}
                  onChange={(e) => setIncludeLogo(e.target.checked)}
                />
                <span>Include store logo in QR code</span>
              </label>

              {includeLogo && (
                <div style={{ display: "grid", gap: 8, paddingLeft: 4 }}>
                  <div style={{ display: "flex", gap: 14, fontSize: 11, color: "#9eb0b2" }}>
                    {store.imageUrl && (
                      <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                        <input
                          type="radio"
                          name="qr-logo-choice"
                          checked={logoSource === "store"}
                          onChange={() => setLogoSource("store")}
                        />
                        <span>Use store profile logo</span>
                      </label>
                    )}
                    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="qr-logo-choice"
                        checked={logoSource === "custom" || !store.imageUrl}
                        onChange={() => setLogoSource("custom")}
                      />
                      <span>Custom logo</span>
                    </label>
                  </div>

                  {(logoSource === "custom" || !store.imageUrl) && (
                    <div style={{ display: "grid", gap: 6 }}>
                      <div style={{ display: "flex", gap: 8 }}>
                        <input
                          type="file"
                          accept="image/*"
                          ref={fileInputRef}
                          style={{ display: "none" }}
                          onChange={handleFileUpload}
                        />
                        <button
                          type="button"
                          className="production-secondary"
                          style={{ padding: "6px 10px", fontSize: 11 }}
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Icon name="upload" size={13} /> Upload image file
                        </button>
                      </div>
                      <input
                        type="url"
                        placeholder="Or enter logo image URL (https://...)"
                        value={customLogoUrl.startsWith("data:") ? "" : customLogoUrl}
                        onChange={(e) => {
                          setCustomLogoUrl(e.target.value);
                          setLogoSource("custom");
                        }}
                        style={{ fontSize: 11, padding: "6px 10px" }}
                      />
                    </div>
                  )}

                  {activeLogoUrl && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
                      <img
                        src={activeLogoUrl}
                        alt="Logo preview"
                        style={{ width: 32, height: 32, objectFit: "contain", borderRadius: 4, background: "#fffaf1", border: "1px solid #091827", padding: 2 }}
                      />
                      <small style={{ color: "#8dd4b3", fontSize: 10 }}>Logo active on QR center</small>
                    </div>
                  )}
                </div>
              )}
            </div>

            {generated && joinUrl ? <>
              <label className="production-field"><span>Join link <small>Raw token shown once</small></span><input value={joinUrl} readOnly /></label>
              <div className="production-qr-actions">
                <button className="production-secondary" type="button" onClick={() => void copy(joinUrl, "Join link copied.")}><Icon name="copy" size={15} />Copy link</button>
                <button className="production-secondary" type="button" onClick={() => void copy(generated.rawToken, "Raw join token copied.")}><Icon name="copy" size={15} />Copy token</button>
                <button className="production-secondary" type="button" onClick={() => { if (downloadQr(qrRef.current, store, activeLogoUrl)) setNotice("Print-quality SVG with embedded logo downloaded."); }}><Icon name="download" size={15} />Download SVG</button>
                <button className="production-secondary" type="button" onClick={async () => {
                  const ok = await downloadPng(qrRef.current, store, activeLogoUrl);
                  if (ok) setNotice("Print-quality PNG with embedded logo downloaded.");
                }}><Icon name="download" size={15} />Download PNG</button>
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
