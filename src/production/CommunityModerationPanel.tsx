import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "../components/Icon";
import type { CommunityChannel, CommunityMessage } from "./types";
import type { ProductionAccessController } from "./useProductionAccess";

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "CM";
}

export function CommunityModerationPanel({ communityId, access }: { communityId: string; access: ProductionAccessController }) {
  const [channels, setChannels] = useState<CommunityChannel[]>([]);
  const [channelId, setChannelId] = useState("");
  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<CommunityMessage | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void access.listCommunityChannels(communityId).then((next) => {
      if (!active) return;
      const visible = next.filter((channel) => channel.isActive);
      setChannels(visible);
      setChannelId((current) => current || visible[0]?.id || "");
    }).catch((error: unknown) => {
      if (active) setLocalError(error instanceof Error ? error.message : "Channels could not be loaded.");
    });
    return () => { active = false; };
  }, [communityId]);

  const loadMessages = async () => {
    if (!channelId) {
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setMessages(await access.listCommunityMessages(communityId, channelId));
      setLocalError(null);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Messages could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadMessages(); }, [communityId, channelId]);

  const remove = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!removing) return;
    setBusy(true);
    setNotice(null);
    setLocalError(null);
    try {
      await access.moderateCommunityMessage(removing.id, reason);
      setRemoving(null);
      setReason("");
      setNotice("Message removed from the community and recorded in the moderation audit.");
      await loadMessages();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "The message could not be removed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="production-moderation-manager">
      <header>
        <div><h4>Message moderation</h4><p>Store administrators can remove community messages. Private direct messages remain inaccessible.</p></div>
        <button className="production-secondary" type="button" onClick={() => void loadMessages()}><Icon name="refresh" size={15} />Refresh</button>
      </header>
      <div className="production-moderation-toolbar">
        <label><span>Channel</span><select value={channelId} onChange={(event) => setChannelId(event.target.value)}>{channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.slug}</option>)}</select></label>
        <small><Icon name="shield" size={14} />Removal is a server-enforced soft delete with an immutable audit record.</small>
      </div>
      {notice && <p className="production-notice production-notice-success" role="status"><Icon name="check" size={16} />{notice}</p>}
      {localError && <p className="production-notice production-notice-error" role="alert"><Icon name="info" size={16} />{localError}</p>}
      {loading ? <div className="production-loading-list"><span /><span /></div> : messages.length === 0 ? <div className="production-moderation-empty"><Icon name="message" size={24} /><span><strong>No visible messages</strong><small>This channel has nothing requiring moderation.</small></span></div> : <div className="production-moderation-list">
        {messages.map((message) => <article key={message.id}>
          <span className="production-message-avatar">{initials(message.authorName)}</span>
          <div><header><strong>{message.authorName}</strong><small>@{message.authorUsername} · {new Date(message.createdAt).toLocaleString()}</small></header><p>{message.body}</p></div>
          <button type="button" aria-label={`Remove message from ${message.authorName}`} onClick={() => { setRemoving(message); setReason(""); setNotice(null); }}><Icon name="trash" size={15} />Remove</button>
        </article>)}
      </div>}

      {removing && <form className="production-remove-message" onSubmit={remove}>
        <header><span><Icon name="shield" size={18} /></span><div><strong>Remove this community message?</strong><small>The message disappears for members and the action cannot be reversed from this workspace.</small></div></header>
        <blockquote>{removing.body}</blockquote>
        <label className="production-field"><span>Moderation reason <small>Required for the audit trail</small></span><textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={1000} rows={3} required placeholder="Explain which community rule this message violates…" /></label>
        <footer><button className="production-secondary" type="button" disabled={busy} onClick={() => setRemoving(null)}>Cancel</button><button className="production-reject" type="submit" disabled={busy}><Icon name="trash" size={15} />{busy ? "Removing…" : "Remove message"}</button></footer>
      </form>}
    </section>
  );
}
