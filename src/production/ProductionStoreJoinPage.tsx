import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { AuthError } from "./ProductionAuthPanel";
import type { StoreJoinCodeValidation, StoreJoinOutcome } from "./types";
import type { ProductionAccessController } from "./useProductionAccess";

type JoinPhase = "checking" | "ready" | "joining" | "success" | "error";

const outcomeCopy: Record<Exclude<StoreJoinOutcome, "joined" | "already_member">, { title: string; detail: string }> = {
  invalid: { title: "This QR code is not valid", detail: "Ask the store team for its current TCG Harbor QR poster." },
  expired: { title: "This QR code has expired", detail: "The store can generate a fresh code from its workspace." },
  revoked: { title: "This QR code was revoked", detail: "For your protection, only the store's newest active QR can be used." },
  rate_limited: { title: "Too many attempts", detail: "Wait a few minutes before trying this or another store code." },
};

function goTo(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function ProductionStoreJoinPage({
  access,
  rawToken,
  onClearStoredIntent,
}: {
  access: ProductionAccessController;
  rawToken: string | null;
  onClearStoredIntent: () => void;
}) {
  const [phase, setPhase] = useState<JoinPhase>(rawToken ? "checking" : "error");
  const [validation, setValidation] = useState<StoreJoinCodeValidation | null>(null);
  const [result, setResult] = useState<StoreJoinOutcome | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!rawToken) {
      setValidation(null);
      setResult(null);
      setLocalError(null);
      setPhase("error");
      return () => { active = false; };
    }
    setPhase("checking");
    setLocalError(null);
    void access.validateStoreJoinCode(rawToken).then((next) => {
      if (!active) return;
      setValidation(next);
      if (!next || next.codeState !== "valid") onClearStoredIntent();
      setPhase(next?.codeState === "valid" ? "ready" : "error");
    }).catch((error: unknown) => {
      if (!active) return;
      setLocalError(error instanceof Error ? error.message : "The QR code could not be checked.");
      setPhase("error");
    });
    return () => { active = false; };
  }, [access, onClearStoredIntent, rawToken]);

  const join = async () => {
    if (!rawToken) return;
    setPhase("joining");
    setLocalError(null);
    try {
      const next = await access.redeemStoreJoinCode(rawToken);
      onClearStoredIntent();
      setResult(next.outcome);
      setPhase(next.outcome === "joined" || next.outcome === "already_member" ? "success" : "error");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "The community could not be joined.");
      setPhase("error");
    }
  };

  const failureOutcome = result && result !== "joined" && result !== "already_member" ? outcomeCopy[result] : null;
  const invalidValidation = validation && validation.codeState !== "valid"
    ? outcomeCopy[validation.codeState === "invalid" ? "invalid" : validation.codeState]
    : null;

  return (
    <main className="production-join-page">
      <section className={`production-join-card ${phase === "error" ? "is-error" : ""}`}>
        {phase === "checking" && <>
          <span className="production-status-icon"><Icon name="qr" size={26} /></span>
          <p className="production-eyebrow">Checking store QR</p>
          <h1>Verifying this invitation…</h1>
          <div className="production-loading-bar"><span /></div>
        </>}

        {(phase === "ready" || phase === "joining") && validation && <>
          <span className="production-status-icon is-success"><Icon name="store" size={26} /></span>
          <p className="production-eyebrow">Verified physical store</p>
          <h1>Join {validation.communityName}</h1>
          <p className="production-join-lead">This community belongs to <strong>{validation.storeName}</strong>. Membership unlocks its player channels and local community updates.</p>
          <div className="production-join-safety"><Icon name="shield" size={18} /><span><strong>Your account stays private</strong><small>The store cannot access your portfolio, cost basis, or direct messages.</small></span></div>
          <button className="production-primary production-join-action" type="button" disabled={phase === "joining"} onClick={() => void join()}>
            <Icon name="users" size={17} />{phase === "joining" ? "Joining community…" : `Join ${validation.storeName}`}
          </button>
          <button className="production-join-cancel" type="button" onClick={() => { onClearStoredIntent(); goTo("/stores"); }}>Not now — browse stores</button>
        </>}

        {phase === "success" && validation && <>
          <span className="production-status-icon is-success"><Icon name="check" size={27} /></span>
          <p className="production-eyebrow">Membership active</p>
          <h1>{result === "already_member" ? "You are already a member" : "Welcome to the community"}</h1>
          <p className="production-join-lead">Your player account now has access to <strong>{validation.communityName}</strong> at {validation.storeName}.</p>
          <button className="production-primary production-join-action" type="button" onClick={() => { onClearStoredIntent(); goTo("/communities"); }}><Icon name="message" size={17} />Open communities</button>
        </>}

        {phase === "error" && <>
          <span className="production-status-icon production-status-error"><Icon name="close" size={25} /></span>
          <p className="production-eyebrow">Invitation unavailable</p>
          <h1>{!rawToken ? "No store invitation was found" : failureOutcome?.title ?? invalidValidation?.title ?? "We could not verify this QR"}</h1>
          <p className="production-join-lead">{!rawToken ? "Scan the current QR poster at a registered store, or enter its printed code manually." : failureOutcome?.detail ?? invalidValidation?.detail ?? "Check your connection and try again."}</p>
          <AuthError message={localError} />
          <div className="production-inline-actions">
            <button className="production-secondary" type="button" onClick={() => { onClearStoredIntent(); goTo("/scan"); }}><Icon name="scan" size={16} />Scan another code</button>
            <button className="production-primary" type="button" onClick={() => { onClearStoredIntent(); goTo("/stores"); }}>Browse stores</button>
          </div>
        </>}
      </section>
    </main>
  );
}
