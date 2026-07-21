import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "../components/Icon";
import { CommunityModerationPanel } from "./CommunityModerationPanel";
import { AuthError } from "./ProductionAuthPanel";
import { StoreQrInviteManager } from "./StoreQrInviteManager";
import type { ProductionAccessController } from "./useProductionAccess";
import type { CommunityChannel, ManagedStore, PendingApplication, StoreApplication, StoreApplicationDraft } from "./types";

function value(data: FormData, name: string): string {
  return String(data.get(name) ?? "").trim();
}

function OptionalField({ label, name, type = "text", placeholder }: { label: string; name: string; type?: string; placeholder?: string }) {
  return <label className="production-field"><span>{label} <small>Optional</small></span><input name={name} type={type} placeholder={placeholder} /></label>;
}

function RequiredField({
  label,
  name,
  type = "text",
  placeholder,
  defaultValue,
  autoComplete,
  min,
  max,
  step,
  maxLength,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  defaultValue?: string;
  autoComplete?: string;
  min?: string;
  max?: string;
  step?: string;
  maxLength?: number;
}) {
  return (
    <label className="production-field">
      <span>{label}</span>
      <input name={name} type={type} placeholder={placeholder} defaultValue={defaultValue} autoComplete={autoComplete} required min={min} max={max} step={step} maxLength={maxLength} />
    </label>
  );
}

export function StoreApplicationPanel({ access }: { access: ProductionAccessController }) {
  const application = access.snapshot?.application ?? null;
  const profile = access.snapshot?.profile;
  const [busy, setBusy] = useState(false);

  if (application?.status === "pending" || application?.status === "under_review") {
    return <ApplicationStatus application={application} access={access} busy={busy} setBusy={setBusy} />;
  }

  if (application?.status === "approved") {
    return (
      <section className="production-panel production-centered-panel">
        <span className="production-status-icon is-success"><Icon name="check" size={25} /></span>
        <p className="production-eyebrow">Approved</p>
        <h2>Your store workspace is being prepared</h2>
        <p>The approval is complete. Refresh if your workspace does not appear within a few seconds.</p>
        <button className="production-secondary" type="button" onClick={() => void access.refresh()}><Icon name="refresh" size={16} />Refresh access</button>
      </section>
    );
  }

  const reapplying = application?.status === "rejected" || application?.status === "withdrawn";
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const draft: StoreApplicationDraft = {
      storeName: value(data, "storeName"),
      contactName: value(data, "contactName"),
      contactEmail: value(data, "contactEmail"),
      phone: value(data, "phone"),
      websiteUrl: value(data, "websiteUrl"),
      addressLine1: value(data, "addressLine1"),
      addressLine2: value(data, "addressLine2"),
      city: value(data, "city"),
      region: value(data, "region"),
      postcode: value(data, "postcode"),
      countryCode: value(data, "countryCode"),
      latitude: Number(value(data, "latitude")),
      longitude: Number(value(data, "longitude")),
      timezone: value(data, "timezone"),
      applicantNote: value(data, "applicantNote"),
      evidenceUrl: value(data, "evidenceUrl"),
    };
    setBusy(true);
    try {
      await access.submitStoreApplication(draft);
    } catch {
      // The controller exposes a safe message through access.error.
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="production-panel production-application-panel">
      <header className="production-panel-header">
        <div>
          <p className="production-eyebrow">Verified store onboarding</p>
          <h2>{reapplying ? "Submit a new store application" : "Register your store"}</h2>
          <p>We use these details to verify the venue and place it accurately on the public store map.</p>
        </div>
        <span className="production-step">Step 1 of 2 · Review follows</span>
      </header>

      {application?.status === "rejected" && (
        <div className="production-review-note">
          <strong>Previous application was not approved</strong>
          <p>{application.reviewNote || "Review the store information and submit updated evidence."}</p>
        </div>
      )}

      <form className="production-form production-store-form" onSubmit={submit}>
        <fieldset>
          <legend>Store identity</legend>
          <div className="production-form-grid">
            <RequiredField label="Store name" name="storeName" placeholder="Dresden Card Harbor" defaultValue={application?.storeName} />
            <RequiredField label="Contact person" name="contactName" autoComplete="name" defaultValue={application?.contactName || profile?.displayName || profile?.username} />
            <RequiredField label="Business email" name="contactEmail" type="email" defaultValue={application?.contactEmail || profile?.email} />
            <OptionalField label="Phone" name="phone" type="tel" placeholder="+49 …" />
            <OptionalField label="Website" name="websiteUrl" type="url" placeholder="https://…" />
            <OptionalField label="Verification evidence" name="evidenceUrl" type="url" placeholder="Public business listing or official website" />
          </div>
        </fieldset>

        <fieldset>
          <legend>Public location</legend>
          <div className="production-form-grid">
            <RequiredField label="Address" name="addressLine1" autoComplete="address-line1" defaultValue={application?.addressLine1} />
            <OptionalField label="Address line 2" name="addressLine2" />
            <RequiredField label="City" name="city" autoComplete="address-level2" defaultValue={application?.city || "Dresden"} />
            <OptionalField label="State / region" name="region" />
            <RequiredField label="Postcode" name="postcode" autoComplete="postal-code" defaultValue={application?.postcode} />
            <RequiredField label="Country code" name="countryCode" placeholder="DE" defaultValue={application?.countryCode || "DE"} maxLength={2} />
            <RequiredField label="Latitude" name="latitude" type="number" placeholder="51.0504" defaultValue={application ? String(application.latitude) : ""} min="-90" max="90" step="any" />
            <RequiredField label="Longitude" name="longitude" type="number" placeholder="13.7373" defaultValue={application ? String(application.longitude) : ""} min="-180" max="180" step="any" />
            <RequiredField label="Timezone" name="timezone" defaultValue={application?.timezone || timezone} />
          </div>
          <p className="production-field-hint"><Icon name="map" size={15} />Coordinates determine the map pin. They are verified before approval.</p>
        </fieldset>

        <label className="production-field">
          <span>Anything we should know? <small>Optional</small></span>
          <textarea name="applicantNote" rows={4} defaultValue={application?.applicantNote ?? ""} placeholder="Events, supported games, community details…" />
        </label>
        <AuthError message={access.error} />
        <div className="production-form-actions">
          <p><Icon name="shield" size={16} />Submitting does not grant store permissions. A platform administrator must approve the application.</p>
          <button className="production-primary" type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit for review"}</button>
        </div>
      </form>
    </section>
  );
}

function ApplicationStatus({
  application,
  access,
  busy,
  setBusy,
}: {
  application: StoreApplication;
  access: ProductionAccessController;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}) {
  const reviewing = application.status === "under_review";
  return (
    <section className="production-panel production-centered-panel">
      <span className={`production-status-icon ${reviewing ? "is-reviewing" : ""}`}><Icon name={reviewing ? "search" : "clock"} size={25} /></span>
      <p className="production-eyebrow">Application {reviewing ? "under review" : "received"}</p>
      <h2>{application.storeName}</h2>
      <p>{reviewing ? "A platform administrator is checking your store details." : "Your application is in the approval queue."} You keep access to all player features while you wait.</p>
      <dl className="production-application-summary">
        <div><dt>Submitted</dt><dd>{new Date(application.submittedAt).toLocaleDateString()}</dd></div>
        <div><dt>Location</dt><dd>{application.postcode} {application.city}, {application.countryCode}</dd></div>
        <div><dt>Contact</dt><dd>{application.contactEmail}</dd></div>
      </dl>
      <AuthError message={access.error} />
      <div className="production-inline-actions">
        <button className="production-secondary" type="button" onClick={() => void access.refresh()}><Icon name="refresh" size={16} />Refresh</button>
        {!reviewing && <button className="production-text-danger" type="button" disabled={busy} onClick={async () => {
          if (!window.confirm("Withdraw this store application? You can submit a new one later.")) return;
          setBusy(true);
          try { await access.withdrawStoreApplication(application.id); }
          catch { /* The controller exposes a safe message through access.error. */ }
          finally { setBusy(false); }
        }}>{busy ? "Withdrawing…" : "Withdraw application"}</button>}
      </div>
    </section>
  );
}

export function StoreWorkspacePanel({ stores, access }: { stores: ManagedStore[]; access: ProductionAccessController }) {
  return (
    <section className="production-panel">
      <header className="production-panel-header">
        <div><p className="production-eyebrow">Store workspace</p><h2>Community operations</h2><p>Manage the verified group chat attached to each approved location.</p></div>
        <span className="production-access-badge"><Icon name="shield" size={15} />Approved owner</span>
      </header>
      <div className="production-store-list">
        {stores.map((store) => <article className="production-store-card" key={store.id}>
          <div className="production-store-heading">
            <span><Icon name="store" size={23} /></span>
            <div><h3>{store.name}</h3><p>{store.postcode} {store.city}, {store.countryCode}</p></div>
            <em className={store.isActive && store.isVerified ? "is-live" : ""}>{store.isActive && store.isVerified ? "Live" : "Paused"}</em>
          </div>
          <div className="production-community-card">
            <div><Icon name="message" size={21} /><span><strong>{store.community?.name || "Store group chat"}</strong><small>{store.community?.isActive ? "Open to verified members" : "Community setup required"}</small></span></div>
            <span className="production-muted-action">Every channel inherits the store community's membership boundary</span>
          </div>
          <div className="production-management-grid" aria-label={`Management capabilities for ${store.name}`}>
            <span><Icon name="users" size={17} /><strong>Members</strong><small>Suspend or restore access</small></span>
            <span><Icon name="message" size={17} /><strong>Chat</strong><small>Moderate messages</small></span>
            <span><Icon name="qr" size={17} /><strong>Join codes</strong><small>Create and revoke invites</small></span>
            <span><Icon name="settings" size={17} /><strong>Community</strong><small>Rules and store details</small></span>
          </div>
          <StoreQrInviteManager store={store} access={access} />
          {store.community && <>
            <CommunityChannelManager communityId={store.community.id} access={access} />
            <CommunityModerationPanel communityId={store.community.id} access={access} />
          </>}
        </article>)}
      </div>
    </section>
  );
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function CommunityChannelManager({ communityId, access }: { communityId: string; access: ProductionAccessController }) {
  const [channels, setChannels] = useState<CommunityChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CommunityChannel | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setChannels(await access.listCommunityChannels(communityId)); }
    catch { /* Controller exposes the message through access.error. */ }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [communityId]);

  const resetEditor = () => {
    setCreating(false);
    setEditing(null);
    setName("");
    setSlug("");
    setDescription("");
    setSlugTouched(false);
  };

  const beginEdit = (channel: CommunityChannel) => {
    setCreating(false);
    setEditing(channel);
    setName(channel.name);
    setSlug(channel.slug);
    setDescription(channel.description ?? "");
    setSlugTouched(true);
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusyId(editing?.id ?? "new");
    try {
      if (editing) await access.updateCommunityChannel(editing.id, { name, slug, description });
      else await access.createCommunityChannel({ communityId, name, slug, description });
      resetEditor();
      await load();
    } catch { /* Controller exposes the message through access.error. */ }
    finally { setBusyId(null); }
  };

  return (
    <section className="production-channel-manager">
      <header>
        <div><h4>Group chat channels</h4><p>Create focused spaces for games, events, trades, or announcements.</p></div>
        {!creating && !editing && <button className="production-secondary" type="button" onClick={() => setCreating(true)}><Icon name="plus" size={15} />New channel</button>}
      </header>
      <AuthError message={access.error} />
      {loading ? <div className="production-channel-loading" aria-busy="true" /> : (
        <div className="production-channel-list">
          {channels.map((channel) => <div key={channel.id} className={!channel.isActive ? "is-archived" : ""}>
            <span className="production-channel-symbol">#</span>
            <span><strong>{channel.name}</strong><small>#{channel.slug}{channel.description ? ` · ${channel.description}` : ""}</small></span>
            {channel.isDefault && <em>Default</em>}
            {channel.isActive && <span className="production-channel-actions">
              <button type="button" onClick={() => beginEdit(channel)} aria-label={`Edit ${channel.name}`}><Icon name="edit" size={14} /></button>
              {!channel.isDefault && <button type="button" disabled={busyId === channel.id} onClick={async () => {
                if (!window.confirm(`Archive #${channel.slug}? Members will no longer see or post in it.`)) return;
                setBusyId(channel.id);
                try { await access.archiveCommunityChannel(channel.id); await load(); }
                catch { /* Controller exposes the message through access.error. */ }
                finally { setBusyId(null); }
              }} aria-label={`Archive ${channel.name}`}><Icon name="trash" size={14} /></button>}
            </span>}
          </div>)}
        </div>
      )}
      {(creating || editing) && <form className="production-channel-editor" onSubmit={save}>
        <div>
          <label className="production-field"><span>Channel name</span><input value={name} required maxLength={80} onChange={(event) => {
            const next = event.target.value;
            setName(next);
            if (!slugTouched) setSlug(slugify(next));
          }} placeholder="Weekly events" /></label>
          <label className="production-field"><span>URL slug</span><input value={slug} required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" onChange={(event) => { setSlug(slugify(event.target.value)); setSlugTouched(true); }} placeholder="weekly-events" /></label>
        </div>
        <label className="production-field"><span>Description <small>Optional</small></span><input value={description} maxLength={2000} onChange={(event) => setDescription(event.target.value)} placeholder="What belongs in this channel?" /></label>
        <footer><button className="production-secondary" type="button" onClick={resetEditor}>Cancel</button><button className="production-primary" type="submit" disabled={busyId !== null}>{busyId ? "Saving…" : editing ? "Save channel" : "Create channel"}</button></footer>
      </form>}
    </section>
  );
}

export function PlatformApprovalPanel({ access }: { access: ProductionAccessController }) {
  const [applications, setApplications] = useState<PendingApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    try { setApplications(await access.listPendingApplications()); }
    catch { /* The controller exposes a safe message through access.error. */ }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []); // The queue also refreshes after every decision.

  const review = async (application: PendingApplication, decision: "approved" | "rejected") => {
    const verb = decision === "approved" ? "approve" : "reject";
    if (!window.confirm(`${verb[0].toUpperCase()}${verb.slice(1)} ${application.storeName}?${decision === "approved" ? " This creates the live store, community, and owner assignment." : ""}`)) return;
    setBusyId(application.id);
    try {
      await access.reviewApplication(application.id, decision, notes[application.id]);
      await load();
    } catch {
      // The controller exposes a safe message through access.error.
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="production-panel">
      <header className="production-panel-header">
        <div><p className="production-eyebrow">Platform administration</p><h2>Store approval queue</h2><p>Only approval creates a public map location and grants store administration.</p></div>
        <button className="production-secondary" type="button" onClick={() => void load()} disabled={loading}><Icon name="refresh" size={16} />Refresh</button>
      </header>
      <AuthError message={access.error} />
      {loading ? <div className="production-loading-list" aria-busy="true"><span /><span /><span /></div> : applications.length === 0 ? (
        <div className="production-empty"><Icon name="check" size={27} /><h3>Queue cleared</h3><p>There are no store applications waiting for review.</p></div>
      ) : (
        <div className="production-approval-list">
          {applications.map((application) => <article key={application.id}>
            <header>
              <div><h3>{application.storeName}</h3><p>{application.contactName} · {application.contactEmail}</p></div>
              <span>{application.status === "under_review" ? "Under review" : "Pending"}</span>
            </header>
            <dl>
              <div><dt>Address</dt><dd>{application.addressLine1}{application.addressLine2 ? `, ${application.addressLine2}` : ""}<br />{application.postcode} {application.city}, {application.countryCode}</dd></div>
              <div><dt>Map pin</dt><dd>{application.latitude.toFixed(5)}, {application.longitude.toFixed(5)}</dd></div>
              <div><dt>Submitted</dt><dd>{new Date(application.submittedAt).toLocaleString()}</dd></div>
              <div><dt>Evidence</dt><dd>{application.evidenceUrl ? <a href={application.evidenceUrl} target="_blank" rel="noreferrer">Open verification link</a> : "None provided"}</dd></div>
            </dl>
            {application.applicantNote && <blockquote>{application.applicantNote}</blockquote>}
            <label className="production-field"><span>Decision note <small>Shown to applicant</small></span><textarea rows={2} value={notes[application.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [application.id]: event.target.value }))} placeholder="Verification result or requested correction…" /></label>
            <footer>
              {application.status === "pending" && <button className="production-secondary" type="button" disabled={busyId === application.id} onClick={async () => {
                setBusyId(application.id);
                try { await access.beginReviewApplication(application.id); await load(); }
                finally { setBusyId(null); }
              }}>Start review</button>}
              <button className="production-reject" type="button" disabled={busyId === application.id} onClick={() => void review(application, "rejected")}>Reject</button>
              <button className="production-primary" type="button" disabled={busyId === application.id} onClick={() => void review(application, "approved")}><Icon name="check" size={16} />{busyId === application.id ? "Saving…" : "Approve store"}</button>
            </footer>
          </article>)}
        </div>
      )}
    </section>
  );
}
