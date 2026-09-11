import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "../components/Icon";
import { StoreAddressMapPreview } from "../components/StoreAddressMapPreview";
import {
  geocodeAddress,
  reverseGeocodeCoordinates,
  isValidLatitude,
  isValidLongitude,
} from "../domain/storeGeocoding";
import { CommunityModerationPanel } from "./CommunityModerationPanel";
import { AuthError } from "./ProductionAuthPanel";
import { StoreQrInviteManager } from "./StoreQrInviteManager";
import { StoreMemberApprovalManager } from "./StoreMemberApprovalManager";
import type { ProductionAccessController } from "./useProductionAccess";
import type {
  CommunityChannel,
  ManagedStore,
  PendingApplication,
  PlatformAdminStore,
  PlatformAdminUpdateStoreDraft,
  StoreApplication,
  StoreApplicationDraft,
} from "./types";

function value(data: FormData, name: string): string {
  return String(data.get(name) ?? "").trim();
}

function OptionalField({
  label,
  name,
  type = "text",
  placeholder,
  defaultValue,
  value,
  onChange,
  autoComplete,
  min,
  max,
  step,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  defaultValue?: string;
  value?: string | number;
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  autoComplete?: string;
  min?: string;
  max?: string;
  step?: string;
}) {
  return (
    <label className="production-field">
      <span>{label} <small>Optional</small></span>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        defaultValue={defaultValue}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        min={min}
        max={max}
        step={step}
      />
    </label>
  );
}

function RequiredField({
  label,
  name,
  type = "text",
  placeholder,
  defaultValue,
  value,
  onChange,
  autoComplete,
  min,
  max,
  step,
  maxLength,
  required = true,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  defaultValue?: string;
  value?: string | number;
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  autoComplete?: string;
  min?: string;
  max?: string;
  step?: string;
  maxLength?: number;
  required?: boolean;
}) {
  return (
    <label className="production-field">
      <span>{label}</span>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        defaultValue={defaultValue}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        required={required}
        min={min}
        max={max}
        step={step}
        maxLength={maxLength}
      />
    </label>
  );
}

export function StoreApplicationPanel({ access }: { access: ProductionAccessController }) {
  const application = access.snapshot?.application ?? null;
  const profile = access.snapshot?.profile;
  const signupDetails = profile?.storeSignupDetails;
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Address fields state
  const [addressLine1, setAddressLine1] = useState(application?.addressLine1 || signupDetails?.addressLine1 || "");
  const [addressLine2, setAddressLine2] = useState(application?.addressLine2 || "");
  const [city, setCity] = useState(application?.city || signupDetails?.city || "Dresden");
  const [region, setRegion] = useState(application?.region || "");
  const [postcode, setPostcode] = useState(application?.postcode || signupDetails?.postcode || "");
  const [countryCode, setCountryCode] = useState(application?.countryCode || signupDetails?.countryCode || "DE");

  // Coordinate state
  const [latitudeInput, setLatitudeInput] = useState(application ? String(application.latitude) : "");
  const [longitudeInput, setLongitudeInput] = useState(application ? String(application.longitude) : "");
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [addressLabel, setAddressLabel] = useState(application?.storeName || "");

  const userManuallySetCoordsRef = useRef(Boolean(application));

  const parsedLat = latitudeInput.trim() !== "" ? Number(latitudeInput) : null;
  const parsedLon = longitudeInput.trim() !== "" ? Number(longitudeInput) : null;
  const hasValidCoordinates = isValidLatitude(parsedLat) && isValidLongitude(parsedLon);

  // Debounced address geocoding when address inputs change
  useEffect(() => {
    const hasAddress = Boolean(addressLine1.trim() || (city.trim() && postcode.trim()));
    if (!hasAddress) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsGeocoding(true);
      try {
        const result = await geocodeAddress({
          addressLine1,
          addressLine2,
          city,
          region,
          postcode,
          countryCode,
        }, controller.signal);

        if (result && !controller.signal.aborted) {
          setLatitudeInput(result.latitude.toFixed(6));
          setLongitudeInput(result.longitude.toFixed(6));
          setAddressLabel(result.displayName);
        }
      } catch {
        // Ignored, graceful fallback
      } finally {
        if (!controller.signal.aborted) {
          setIsGeocoding(false);
        }
      }
    }, 550);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [addressLine1, addressLine2, city, region, postcode, countryCode]);

  const handleMapCoordinatesChange = useCallback(async (lat: number, lon: number) => {
    userManuallySetCoordsRef.current = true;
    setLatitudeInput(lat.toFixed(6));
    setLongitudeInput(lon.toFixed(6));

    // If street address is empty, reverse-geocode to assist the user
    if (!addressLine1.trim()) {
      try {
        const rev = await reverseGeocodeCoordinates(lat, lon);
        if (rev) {
          if (rev.road && !addressLine1.trim()) setAddressLine1(rev.road);
          if (rev.city && (!city.trim() || city === "Dresden")) setCity(rev.city);
          if (rev.postcode && !postcode.trim()) setPostcode(rev.postcode);
          if (rev.countryCode) setCountryCode(rev.countryCode);
          setAddressLabel(rev.displayName);
        }
      } catch {
        // Graceful fallback
      }
    }
  }, [addressLine1, city, postcode]);

  const handleLatitudeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    userManuallySetCoordsRef.current = true;
    setLatitudeInput(e.target.value);
  };

  const handleLongitudeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    userManuallySetCoordsRef.current = true;
    setLongitudeInput(e.target.value);
  };

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
    setFormError(null);
    const data = new FormData(event.currentTarget);

    let finalLat = parsedLat;
    let finalLon = parsedLon;

    // If coordinates were not entered manually or geocoded yet, attempt geocoding now
    if (!isValidLatitude(finalLat) || !isValidLongitude(finalLon)) {
      setBusy(true);
      const geocoded = await geocodeAddress({
        addressLine1,
        addressLine2,
        city,
        region,
        postcode,
        countryCode,
      });
      setBusy(false);
      if (geocoded) {
        finalLat = geocoded.latitude;
        finalLon = geocoded.longitude;
        setLatitudeInput(geocoded.latitude.toFixed(6));
        setLongitudeInput(geocoded.longitude.toFixed(6));
      } else {
        setFormError("Could not determine store coordinates. Please enter a valid street address or specify latitude and longitude.");
        return;
      }
    }

    // Ensure address fields meet database constraints even if coordinates were entered as alternative
    const finalAddress1 = addressLine1.trim() || `Location (${finalLat.toFixed(5)}, ${finalLon.toFixed(5)})`;
    const finalCity = city.trim() || "Dresden";
    const finalPostcode = postcode.trim() || "00000";
    const finalCountry = (countryCode.trim() || "DE").toUpperCase();

    const draft: StoreApplicationDraft = {
      storeName: value(data, "storeName"),
      contactName: value(data, "contactName"),
      contactEmail: value(data, "contactEmail"),
      phone: value(data, "phone"),
      websiteUrl: value(data, "websiteUrl"),
      addressLine1: finalAddress1,
      addressLine2: addressLine2.trim() || value(data, "addressLine2"),
      city: finalCity,
      region: region.trim() || value(data, "region"),
      postcode: finalPostcode,
      countryCode: finalCountry,
      latitude: finalLat,
      longitude: finalLon,
      timezone: value(data, "timezone") || timezone,
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
            <RequiredField label="Store name" name="storeName" placeholder="Dresden Card Harbor" defaultValue={application?.storeName || signupDetails?.storeName} />
            <RequiredField label="Contact person" name="contactName" autoComplete="name" defaultValue={application?.contactName || profile?.displayName || profile?.username} />
            <RequiredField label="Business email" name="contactEmail" type="email" defaultValue={application?.contactEmail || profile?.email} />
            <OptionalField label="Phone" name="phone" type="tel" placeholder="+49 …" />
            <OptionalField label="Website" name="websiteUrl" type="url" placeholder="https://…" defaultValue={application?.websiteUrl || signupDetails?.websiteUrl} />
            <OptionalField label="Verification evidence" name="evidenceUrl" type="url" placeholder="Public business listing or official website" />
          </div>
        </fieldset>

        <fieldset>
          <legend>Public location</legend>
          <div className="production-form-grid">
            <RequiredField
              label="Address"
              name="addressLine1"
              autoComplete="address-line1"
              value={addressLine1}
              onChange={(e) => setAddressLine1(e.target.value)}
              required={!hasValidCoordinates}
            />
            <OptionalField
              label="Address line 2"
              name="addressLine2"
              value={addressLine2}
              onChange={(e) => setAddressLine2(e.target.value)}
            />
            <RequiredField
              label="City"
              name="city"
              autoComplete="address-level2"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
            <OptionalField
              label="State / region"
              name="region"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
            />
            <RequiredField
              label="Postcode"
              name="postcode"
              autoComplete="postal-code"
              value={postcode}
              onChange={(e) => setPostcode(e.target.value)}
              required={!hasValidCoordinates}
            />
            <RequiredField
              label="Country code"
              name="countryCode"
              placeholder="DE"
              maxLength={2}
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
            />
          </div>

          <StoreAddressMapPreview
            latitude={hasValidCoordinates ? parsedLat : undefined}
            longitude={hasValidCoordinates ? parsedLon : undefined}
            addressLabel={addressLabel}
            isGeocoding={isGeocoding}
            onCoordinatesChange={handleMapCoordinatesChange}
          />

          <div className="production-form-grid">
            <OptionalField
              label="Latitude"
              name="latitude"
              type="number"
              placeholder="51.0504"
              value={latitudeInput}
              onChange={handleLatitudeChange}
              min="-90"
              max="90"
              step="any"
            />
            <OptionalField
              label="Longitude"
              name="longitude"
              type="number"
              placeholder="13.7373"
              value={longitudeInput}
              onChange={handleLongitudeChange}
              min="-180"
              max="180"
              step="any"
            />
            <RequiredField
              label="Timezone"
              name="timezone"
              defaultValue={application?.timezone || timezone}
            />
          </div>
          <p className="production-field-hint">
            <Icon name="map" size={15} />
            The map pin updates automatically from your address. You can also click on the map, drag the pin, or enter coordinates as an alternative.
          </p>
        </fieldset>

        <label className="production-field">
          <span>Anything we should know? <small>Optional</small></span>
          <textarea name="applicantNote" rows={4} defaultValue={application?.applicantNote ?? ""} placeholder="Events, supported games, community details…" />
        </label>
        <AuthError message={formError || access.error} />
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
          <StoreMemberApprovalManager store={store} access={access} />
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

interface StoreEditModalProps {
  store: PlatformAdminStore;
  onClose: () => void;
  onSave: (draft: PlatformAdminUpdateStoreDraft) => Promise<void>;
  busy: boolean;
  error: string | null;
}

function StoreEditModal({ store, onClose, onSave, busy, error }: StoreEditModalProps) {
  const [name, setName] = useState(store.name);
  const [slug, setSlug] = useState(store.slug);
  const [ownerUsername, setOwnerUsername] = useState(store.ownerUsername || "");
  const [addressLine1, setAddressLine1] = useState(store.addressLine1);
  const [addressLine2, setAddressLine2] = useState(store.addressLine2 || "");
  const [city, setCity] = useState(store.city);
  const [region, setRegion] = useState(store.region || "");
  const [postcode, setPostcode] = useState(store.postcode);
  const [countryCode, setCountryCode] = useState(store.countryCode);
  const [latitude, setLatitude] = useState(String(store.latitude));
  const [longitude, setLongitude] = useState(String(store.longitude));
  const [contactEmail, setContactEmail] = useState(store.contactEmail || "");
  const [phone, setPhone] = useState(store.phone || "");
  const [websiteUrl, setWebsiteUrl] = useState(store.websiteUrl || "");
  const [autoGeocoding, setAutoGeocoding] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleAutoGeocode = async () => {
    setAutoGeocoding(true);
    setLocalError(null);
    try {
      const res = await geocodeAddress({ addressLine1, addressLine2, city, region, postcode, countryCode });
      if (res) {
        setLatitude(res.latitude.toFixed(6));
        setLongitude(res.longitude.toFixed(6));
      } else {
        setLocalError("Could not resolve address coordinates automatically.");
      }
    } catch {
      setLocalError("Geocoding lookup failed.");
    } finally {
      setAutoGeocoding(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    const lat = Number(latitude);
    const lon = Number(longitude);
    if (!isValidLatitude(lat) || !isValidLongitude(lon)) {
      setLocalError("Please enter valid latitude (-90..90) and longitude (-180..180) coordinates.");
      return;
    }

    await onSave({
      storeId: store.id,
      name: name.trim(),
      slug: slug.trim().toLowerCase(),
      ownerUsername: ownerUsername.trim() || null,
      addressLine1: addressLine1.trim(),
      addressLine2: addressLine2.trim() || null,
      city: city.trim(),
      region: region.trim() || null,
      postcode: postcode.trim(),
      countryCode: countryCode.trim().toUpperCase(),
      latitude: lat,
      longitude: lon,
      contactEmail: contactEmail.trim() || null,
      phone: phone.trim() || null,
      websiteUrl: websiteUrl.trim() || null,
    });
  };

  return (
    <div className="production-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="production-modal-dialog" role="dialog" aria-labelledby="edit-store-heading">
        <header className="production-modal-header">
          <div>
            <p className="production-eyebrow">Platform management</p>
            <h2 id="edit-store-heading">Edit store details</h2>
            <p>Update location, street address, handle, or assigned administrator.</p>
          </div>
          <button type="button" className="production-modal-close" onClick={onClose} disabled={busy} aria-label="Close dialog">
            <Icon name="close" size={18} />
          </button>
        </header>

        <form className="production-form" onSubmit={handleSubmit}>
          <fieldset>
            <legend>Store identity</legend>
            <div className="production-form-grid">
              <label className="production-field">
                <span>Store name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} />
              </label>
              <label className="production-field">
                <span>Store slug / handle</span>
                <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" />
              </label>
              <label className="production-field">
                <span>Owner username <small>Assigns administrator</small></span>
                <input value={ownerUsername} onChange={(e) => setOwnerUsername(e.target.value)} placeholder="Username of account" />
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend>Street address & location</legend>
            <div className="production-form-grid">
              <label className="production-field">
                <span>Street address</span>
                <input value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} required placeholder="Prager Straße 10" />
              </label>
              <label className="production-field">
                <span>Address line 2 <small>Optional</small></span>
                <input value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} placeholder="Floor, suite, building" />
              </label>
              <label className="production-field">
                <span>City</span>
                <input value={city} onChange={(e) => setCity(e.target.value)} required />
              </label>
              <label className="production-field">
                <span>State / Region <small>Optional</small></span>
                <input value={region} onChange={(e) => setRegion(e.target.value)} />
              </label>
              <label className="production-field">
                <span>Postcode</span>
                <input value={postcode} onChange={(e) => setPostcode(e.target.value)} required />
              </label>
              <label className="production-field">
                <span>Country code</span>
                <input value={countryCode} maxLength={2} onChange={(e) => setCountryCode(e.target.value.toUpperCase())} required />
              </label>
            </div>

            <div className="production-coordinate-row">
              <div className="production-form-grid">
                <label className="production-field">
                  <span>Latitude</span>
                  <input type="number" step="any" min="-90" max="90" value={latitude} onChange={(e) => setLatitude(e.target.value)} required />
                </label>
                <label className="production-field">
                  <span>Longitude</span>
                  <input type="number" step="any" min="-180" max="180" value={longitude} onChange={(e) => setLongitude(e.target.value)} required />
                </label>
              </div>
              <button type="button" className="production-secondary production-geocode-btn" onClick={handleAutoGeocode} disabled={autoGeocoding || busy}>
                <Icon name="locate" size={14} />
                {autoGeocoding ? "Detecting…" : "Auto-detect from address"}
              </button>
            </div>
          </fieldset>

          <fieldset>
            <legend>Contact & listing</legend>
            <div className="production-form-grid">
              <label className="production-field">
                <span>Contact email <small>Optional</small></span>
                <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="store@example.com" />
              </label>
              <label className="production-field">
                <span>Phone <small>Optional</small></span>
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+49 …" />
              </label>
              <label className="production-field">
                <span>Website URL <small>Optional</small></span>
                <input type="url" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://…" />
              </label>
            </div>
          </fieldset>

          <AuthError message={localError || error} />

          <footer className="production-modal-actions">
            <button type="button" className="production-secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="production-primary" disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

export function PlatformApprovalPanel({ access }: { access: ProductionAccessController }) {
  const [activeTab, setActiveTab] = useState<"queue" | "approved">("queue");
  const [applications, setApplications] = useState<PendingApplication[]>([]);
  const [approvedStores, setApprovedStores] = useState<PlatformAdminStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingStores, setLoadingStores] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [editingStore, setEditingStore] = useState<PlatformAdminStore | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);

  const loadApplications = async () => {
    setLoading(true);
    try {
      setApplications(await access.listPendingApplications());
    } catch {
      // The controller exposes a safe message through access.error.
    } finally {
      setLoading(false);
    }
  };

  const loadApprovedStores = async () => {
    setLoadingStores(true);
    try {
      setApprovedStores(await access.listApprovedStores());
    } catch {
      // The controller exposes a safe message through access.error.
    } finally {
      setLoadingStores(false);
    }
  };

  useEffect(() => {
    void loadApplications();
    void loadApprovedStores();
  }, []);

  const review = async (application: PendingApplication, decision: "approved" | "rejected") => {
    const verb = decision === "approved" ? "approve" : "reject";
    if (!window.confirm(`${verb[0].toUpperCase()}${verb.slice(1)} ${application.storeName}?${decision === "approved" ? " This creates the live store, community, and owner assignment." : ""}`)) return;
    setBusyId(application.id);
    try {
      await access.reviewApplication(application.id, decision, notes[application.id]);
      await loadApplications();
      await loadApprovedStores();
    } catch {
      // The controller exposes a safe message through access.error.
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveStore = async (draft: PlatformAdminUpdateStoreDraft) => {
    setEditBusy(true);
    setEditError(null);
    try {
      await access.updateApprovedStore(draft);
      setEditingStore(null);
      await loadApprovedStores();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update store details.");
    } finally {
      setEditBusy(false);
    }
  };

  const handleDeleteStore = async (store: PlatformAdminStore) => {
    if (!window.confirm(`Are you sure you want to delete "${store.name}" (@${store.slug})?\n\nThis will take down its public listing, community, and active store administrator assignments.`)) {
      return;
    }
    setDeleteBusyId(store.id);
    try {
      await access.deleteApprovedStore(store.id);
      await loadApprovedStores();
    } catch {
      // exposed via access.error
    } finally {
      setDeleteBusyId(null);
    }
  };

  const filteredApprovedStores = approvedStores.filter((store) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      store.name.toLowerCase().includes(q) ||
      store.slug.toLowerCase().includes(q) ||
      store.city.toLowerCase().includes(q) ||
      store.addressLine1.toLowerCase().includes(q) ||
      (store.ownerUsername && store.ownerUsername.toLowerCase().includes(q))
    );
  });

  return (
    <section className="production-panel">
      <header className="production-panel-header">
        <div>
          <p className="production-eyebrow">Platform administration</p>
          <h2>Store approval & directory</h2>
          <p>Review new store applications or manage live approved locations, street addresses, and administrators.</p>
        </div>
        <button
          className="production-secondary"
          type="button"
          onClick={() => { void loadApplications(); void loadApprovedStores(); }}
          disabled={loading || loadingStores}
        >
          <Icon name="refresh" size={16} />Refresh
        </button>
      </header>

      <div className="production-approval-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "queue"}
          className={`production-approval-tab ${activeTab === "queue" ? "is-active" : ""}`}
          onClick={() => setActiveTab("queue")}
        >
          Pending applications
          {applications.length > 0 && <span className="production-tab-badge">{applications.length}</span>}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "approved"}
          className={`production-approval-tab ${activeTab === "approved" ? "is-active" : ""}`}
          onClick={() => {
            setActiveTab("approved");
            void loadApprovedStores();
          }}
        >
          Approved stores
          <span className="production-tab-badge is-neutral">{approvedStores.length}</span>
        </button>
      </div>

      <AuthError message={access.error} />

      {activeTab === "queue" && (
        <>
          {loading ? (
            <div className="production-loading-list" aria-busy="true"><span /><span /><span /></div>
          ) : applications.length === 0 ? (
            <div className="production-empty">
              <Icon name="check" size={27} />
              <h3>Queue cleared</h3>
              <p>There are no store applications waiting for review.</p>
            </div>
          ) : (
            <div className="production-approval-list">
              {applications.map((application) => (
                <article key={application.id}>
                  <header>
                    <div>
                      <h3>{application.storeName}</h3>
                      <p>{application.contactName} · {application.contactEmail}</p>
                    </div>
                    <span>{application.status === "under_review" ? "Under review" : "Pending"}</span>
                  </header>
                  <dl>
                    <div>
                      <dt>Address</dt>
                      <dd>{application.addressLine1}{application.addressLine2 ? `, ${application.addressLine2}` : ""}<br />{application.postcode} {application.city}, {application.countryCode}</dd>
                    </div>
                    <div>
                      <dt>Map pin</dt>
                      <dd>{application.latitude.toFixed(5)}, {application.longitude.toFixed(5)}</dd>
                    </div>
                    <div>
                      <dt>Submitted</dt>
                      <dd>{new Date(application.submittedAt).toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>Evidence</dt>
                      <dd>{application.evidenceUrl ? <a href={application.evidenceUrl} target="_blank" rel="noreferrer">Open verification link</a> : "None provided"}</dd>
                    </div>
                  </dl>
                  {application.applicantNote && <blockquote>{application.applicantNote}</blockquote>}
                  <label className="production-field">
                    <span>Decision note <small>Shown to applicant</small></span>
                    <textarea
                      rows={2}
                      value={notes[application.id] ?? ""}
                      onChange={(event) => setNotes((current) => ({ ...current, [application.id]: event.target.value }))}
                      placeholder="Verification result or requested correction…"
                    />
                  </label>
                  <footer>
                    {application.status === "pending" && (
                      <button className="production-secondary" type="button" disabled={busyId === application.id} onClick={async () => {
                        setBusyId(application.id);
                        try { await access.beginReviewApplication(application.id); await loadApplications(); }
                        finally { setBusyId(null); }
                      }}>Start review</button>
                    )}
                    <button className="production-reject" type="button" disabled={busyId === application.id} onClick={() => void review(application, "rejected")}>Reject</button>
                    <button className="production-primary" type="button" disabled={busyId === application.id} onClick={() => void review(application, "approved")}>
                      <Icon name="check" size={16} />{busyId === application.id ? "Saving…" : "Approve store"}
                    </button>
                  </footer>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === "approved" && (
        <div className="production-approved-stores-section">
          <div className="production-approved-toolbar">
            <label className="production-search-field">
              <Icon name="search" size={15} />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search approved stores by name, city, street, or owner…"
              />
              {searchQuery && (
                <button type="button" onClick={() => setSearchQuery("")} aria-label="Clear search">
                  <Icon name="close" size={13} />
                </button>
              )}
            </label>
            <span className="production-count-pill">{filteredApprovedStores.length} of {approvedStores.length} stores</span>
          </div>

          {loadingStores ? (
            <div className="production-loading-list" aria-busy="true"><span /><span /><span /></div>
          ) : filteredApprovedStores.length === 0 ? (
            <div className="production-empty">
              <Icon name="store" size={27} />
              <h3>No stores found</h3>
              <p>{searchQuery ? "Try a different search keyword." : "There are currently no approved stores."}</p>
            </div>
          ) : (
            <div className="production-approved-stores-list">
              {filteredApprovedStores.map((store) => (
                <article key={store.id} className="production-approved-store-card">
                  <header>
                    <div>
                      <div className="production-store-title-row">
                        <h3>{store.name}</h3>
                        <code className="production-store-slug">@{store.slug}</code>
                      </div>
                      <p>{store.city}, {store.countryCode} {store.communityName ? `· ${store.communityName}` : ""}</p>
                    </div>
                    <span className="production-badge is-active">Approved</span>
                  </header>

                  <dl>
                    <div>
                      <dt>Street address</dt>
                      <dd>
                        {store.addressLine1}
                        {store.addressLine2 ? `, ${store.addressLine2}` : ""}
                        <br />
                        {store.postcode} {store.city}, {store.countryCode}
                      </dd>
                    </div>
                    <div>
                      <dt>Map coordinates</dt>
                      <dd>
                        {store.latitude.toFixed(5)}, {store.longitude.toFixed(5)}
                      </dd>
                    </div>
                    <div>
                      <dt>Store administrator</dt>
                      <dd>
                        {store.ownerUsername ? (
                          <span>
                            <strong>@{store.ownerUsername}</strong>
                            {store.ownerDisplayName ? ` (${store.ownerDisplayName})` : ""}
                          </span>
                        ) : (
                          <em className="production-text-muted">Unassigned</em>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Contact & listing</dt>
                      <dd>
                        {store.contactEmail || store.phone || store.websiteUrl ? (
                          <span>
                            {store.contactEmail && <div>{store.contactEmail}</div>}
                            {store.phone && <div>{store.phone}</div>}
                            {store.websiteUrl && <a href={store.websiteUrl} target="_blank" rel="noreferrer">Website</a>}
                          </span>
                        ) : (
                          <em className="production-text-muted">None provided</em>
                        )}
                      </dd>
                    </div>
                  </dl>

                  <footer>
                    <button
                      type="button"
                      className="production-secondary"
                      onClick={() => setEditingStore(store)}
                    >
                      <Icon name="edit" size={14} />Edit details
                    </button>
                    <button
                      type="button"
                      className="production-reject"
                      disabled={deleteBusyId === store.id}
                      onClick={() => void handleDeleteStore(store)}
                    >
                      <Icon name="trash" size={14} />
                      {deleteBusyId === store.id ? "Deleting…" : "Delete store"}
                    </button>
                  </footer>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {editingStore && (
        <StoreEditModal
          store={editingStore}
          onClose={() => setEditingStore(null)}
          onSave={handleSaveStore}
          busy={editBusy}
          error={editError}
        />
      )}
    </section>
  );
}
