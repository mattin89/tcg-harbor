import { useState } from "react";
import { Icon } from "../components/Icon";
import { initialStoreJoinRequests } from "../data/demo";
import type { ManagedStore, StoreJoinRequest } from "./types";
import type { ProductionAccessController } from "./useProductionAccess";

export function StoreMemberApprovalManager({
  store,
  access: _access,
}: {
  store: ManagedStore;
  access: ProductionAccessController;
}) {
  const [requiresApproval, setRequiresApproval] = useState(store.requiresMemberApproval ?? false);
  const [requests, setRequests] = useState<StoreJoinRequest[]>(() =>
    initialStoreJoinRequests.filter(
      (r) => r.storeId === store.id || (store.slug && store.slug.includes("berlin"))
    )
  );
  const [notice, setNotice] = useState<string | null>(null);

  const toggleApproval = () => {
    const next = !requiresApproval;
    setRequiresApproval(next);
    setNotice(
      next
        ? "Manual member approval enabled. New QR scans will require confirmation."
        : "Automatic member join enabled. Players scanning your QR code join immediately."
    );
  };

  const acceptRequest = (requestId: string) => {
    setRequests((prev) => prev.filter((r) => r.id !== requestId));
    setNotice("Join request accepted. Player granted community access.");
  };

  const rejectRequest = (requestId: string) => {
    setRequests((prev) => prev.filter((r) => r.id !== requestId));
    setNotice("Join request declined.");
  };

  return (
    <section className="production-approval-manager">
      <header>
        <div>
          <h4>Member confirmation</h4>
          <p>Require store staff confirmation before new players join your community.</p>
        </div>
        <label className="toggle-switch-label" aria-label="Require manual member approval">
          <input
            type="checkbox"
            checked={requiresApproval}
            onChange={toggleApproval}
          />
          <span className="toggle-slider" />
        </label>
      </header>
      {notice && (
        <p className="production-notice production-notice-success" role="status">
          <Icon name="check" size={16} />
          {notice}
        </p>
      )}
      <div className="production-approval-explainer">
        <Icon name="shield" size={16} />
        <span>
          {requiresApproval
            ? "Manual approval is ON. Players scanning your QR code must submit a request and wait for your confirmation."
            : "Automatic join is ON (Default). Players scanning your physical QR code join immediately."}
        </span>
      </div>
      {requiresApproval && (
        <div className="production-pending-list">
          <h5>Pending member requests ({requests.length})</h5>
          {requests.length === 0 ? (
            <div className="production-pending-empty">
              <Icon name="users" size={20} />
              <span>No pending requests at this time.</span>
            </div>
          ) : (
            requests.map((req) => (
              <article key={req.id} className="production-pending-card">
                <span className="production-message-avatar">{req.userInitials}</span>
                <div className="production-pending-card-body">
                  <strong>{req.userName}</strong>
                  <time>{req.requestedAt}</time>
                  {req.note && <p>“{req.note}”</p>}
                </div>
                <div className="production-pending-card-actions">
                  <button
                    type="button"
                    className="production-accept-btn"
                    onClick={() => acceptRequest(req.id)}
                  >
                    <Icon name="check" size={14} />
                    Accept
                  </button>
                  <button
                    type="button"
                    className="production-reject-btn"
                    onClick={() => rejectRequest(req.id)}
                  >
                    <Icon name="close" size={14} />
                    Decline
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      )}
    </section>
  );
}
