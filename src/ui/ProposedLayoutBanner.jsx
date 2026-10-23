/**
 * ui/ProposedLayoutBanner.jsx
 *
 * Human-in-the-loop review banner for Task R8 (Photo reconstruction plumbing).
 * Displays when a photo has been analyzed into a proposed layout.
 *
 * The active layout is NEVER overwritten automatically:
 * - "Approve & Apply": merges the proposed rooms and furniture via editorHistory (undoable!).
 * - "Discard": dismisses the proposal without touching the workplace.
 */

import { Sparkles, Check, X, Loader2, AlertCircle } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { updateProposalStatus } from '../services/reconstructionService';

export default function ProposedLayoutBanner({ editor, onMessage }) {
  const proposedLayout = useWorkspaceStore((s) => s.proposedLayout);
  const isReconstructing = useWorkspaceStore((s) => s.isReconstructing);
  const reconstructionError = useWorkspaceStore((s) => s.reconstructionError);
  const clearProposedLayout = useWorkspaceStore((s) => s.clearProposedLayout);

  if (isReconstructing) {
    return (
      <aside className="proposed-layout-banner is-loading" role="status" aria-live="polite">
        <div className="proposed-layout-banner__content">
          <Loader2 size={18} className="proposed-layout-banner__spinner" aria-hidden />
          <span>Uploading photo and reconstructing workplace layout…</span>
        </div>
      </aside>
    );
  }

  if (reconstructionError) {
    return (
      <aside className="proposed-layout-banner is-error" role="alert">
        <div className="proposed-layout-banner__content">
          <AlertCircle size={18} className="proposed-layout-banner__icon" aria-hidden />
          <span>Photo reconstruction: {reconstructionError}</span>
        </div>
        <button
          className="ui-btn ui-btn--ghost proposed-layout-banner__btn"
          onClick={clearProposedLayout}
          aria-label="Dismiss error"
        >
          Dismiss
        </button>
      </aside>
    );
  }

  if (!proposedLayout) return null;

  const stats = proposedLayout.detectionStats || {
    roomCount: proposedLayout.layout?.rooms?.length ?? 0,
    objectCount: proposedLayout.layout?.objects?.length ?? 0,
  };

  const handleApprove = async () => {
    try {
      const candidate = proposedLayout.layout || proposedLayout.proposedLayout;
      if (editor?.applyProposedLayout) {
        editor.applyProposedLayout(candidate);
      }
      if (proposedLayout.proposalId) {
        await updateProposalStatus(proposedLayout.proposalId, 'approved').catch(() => {});
      }
      clearProposedLayout();
      onMessage?.('Proposed layout applied to workplace (press Ctrl+Z to undo)');
    } catch (err) {
      onMessage?.(`Could not apply layout: ${err?.message || err}`);
    }
  };

  const handleDiscard = async () => {
    if (proposedLayout.proposalId) {
      await updateProposalStatus(proposedLayout.proposalId, 'rejected').catch(() => {});
    }
    clearProposedLayout();
    onMessage?.('Proposed layout discarded');
  };

  return (
    <aside className="proposed-layout-banner" role="region" aria-label="AI Proposed Layout">
      <div className="proposed-layout-banner__content">
        <Sparkles size={18} className="proposed-layout-banner__icon" aria-hidden />
        <div className="proposed-layout-banner__text">
          <strong>AI Proposed Layout:</strong>{' '}
          <span>
            {stats.roomCount} {stats.roomCount === 1 ? 'room' : 'rooms'} and {stats.objectCount}{' '}
            {stats.objectCount === 1 ? 'item' : 'items'} detected from photo.
          </span>
        </div>
      </div>
      <div className="proposed-layout-banner__actions">
        <button
          className="ui-btn ui-btn--primary proposed-layout-banner__btn"
          onClick={handleApprove}
          title="Add detected rooms and furniture to this workplace (undoable)"
        >
          <Check size={16} aria-hidden /> Approve & Apply
        </button>
        <button
          className="ui-btn ui-btn--ghost proposed-layout-banner__btn"
          onClick={handleDiscard}
          title="Discard this proposed layout without changing your workplace"
        >
          <X size={16} aria-hidden /> Discard
        </button>
      </div>
    </aside>
  );
}
