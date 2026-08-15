"use client";

import { useState } from "react";
import { playerFetch } from "@/lib/player/client";

type HelpState = "idle" | "open" | "sending" | "sent" | "already";

/**
 * "Request help from a human".
 *
 * Extracted from the header so it can sit in the project dashboard when there
 * is one and stay in the header when there is not. It must never be the thing
 * that disappears because a learner has no project — someone without a project
 * is, if anything, more likely to need a person.
 *
 * Owns its own state deliberately: the request is fire-and-forget from the
 * player's point of view, and hoisting `sent`/`already` into the lesson
 * component would tangle it with block progress for no gain.
 */
export function HelpRequestPanel({
  course,
  lessonKey,
  blockId,
}: {
  course: string;
  lessonKey: string;
  blockId?: string;
}) {
  const [state, setState] = useState<HelpState>("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  /**
   * Not gated on a non-empty message: pressing the button *is* the request, and
   * someone stuck enough to ask for a human should not also have to compose a
   * sentence about it.
   *
   * `already` is not an error path. The learner did the reasonable thing twice;
   * the server bumped the occurrence count, and the only useful thing to tell
   * them is that it is already in.
   */
  async function send() {
    setState("sending");
    setError("");
    try {
      const result = await playerFetch<{ status: "created" | "already_open" }>(
        `/api/learn/${encodeURIComponent(course)}/help`,
        {
          method: "POST",
          body: JSON.stringify({ message: message.trim() || undefined, lessonKey, blockId }),
        },
      );
      setMessage("");
      setState(result.status === "already_open" ? "already" : "sent");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to send your request");
      setState("open");
    }
  }

  return (
    <div className="player-help">
      {/*
        Plain, always visible, never behind a menu. A learner who needs a person
        is the least likely person on this page to go hunting through an
        overflow menu for the way to say so.
      */}
      {(state === "idle" || state === "open") && (
        <button
          type="button"
          className="player-help-trigger"
          aria-expanded={state === "open"}
          onClick={() => setState(state === "open" ? "idle" : "open")}
        >
          Request help from a human
        </button>
      )}

      {state === "open" && (
        <div className="player-help-panel">
          <label htmlFor="player-help-message">What do you need help with? (optional)</label>
          <textarea
            id="player-help-message"
            rows={3}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="You can leave this blank."
          />
          <div className="player-help-actions">
            <button type="button" onClick={send}>Send request</button>
            <button
              type="button"
              className="player-help-cancel"
              onClick={() => { setState("idle"); setError(""); }}
            >
              Cancel
            </button>
          </div>
          {error && <p className="player-error">{error}</p>}
        </div>
      )}

      {state === "sending" && <p className="player-help-status">Sending…</p>}

      {/*
        Confirms a human will follow up, and says nothing about when. Nobody on
        the mentor side has committed to a response time, so promising one here
        would be inventing it.
      */}
      {state === "sent" && (
        <p className="player-help-status" role="status">
          Your request has been sent. A human will follow up with you.
        </p>
      )}
      {state === "already" && (
        <p className="player-help-status" role="status">
          You have already asked for help. Your request is still open and a human will follow up with you.
        </p>
      )}
    </div>
  );
}
