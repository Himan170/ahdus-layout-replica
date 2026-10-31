/**
 * useStudioFileActions.js
 *
 * Workplace Studio's file and layout actions, moved as one piece out of WorkplaceEditor.jsx
 * (same useCallback dependencies): back to all layouts, reload the other tab's save, export /
 * import a layout file, save as a copy, floor plan PNG / PDF, and photo reconstruction (off
 * unless the backend flag is on: services/backendFlags.js). Inside AHDUS also Publish, and
 * Import puts the file's layout into the open workplace (one undo step) instead of adding a layout.
 *
 * WorkplaceEditor passes in what they use under the same names and gets them back.
 */

import { useCallback } from 'react';

import { useWorkspaceStore } from '../store/workspaceStore';
import {
  saveNow, reloadLayout, saveAsCopy, exportLayout, importLayout, readLayoutFile, publishLayout,
} from '../services/apiService';
import { isAhdusBackendOn } from '../services/backendFlags';
import { downloadText } from '../ui/download';
import { exportFloorPlanAsPng, exportFloorPlanAsPdf } from '../utils/floorPlanExporter';
import {
  isPhotoReconstructionOn,
  RECONSTRUCTION_OFF,
  uploadReconstructionPhoto,
  requestPhotoAnalysis,
  stageProposedLayout,
} from '../services/reconstructionService';

export function useStudioFileActions({ onExit, editor, showStudioMessage, gizmoControllerRef, setExportLoading }) {
  const handleAllLayouts = useCallback(async () => {
    const result = await saveNow();
    if (!result.ok && !window.confirm(`Your last changes could not be saved: ${result.error}.\nLeave anyway?`)) return;
    useWorkspaceStore.getState().resetWorkspace();
    onExit();
  }, [onExit]);

  // Another tab saved this layout: load theirs (our undo steps describe the old
  // layout, so they go), or keep ours as a new layout.
  const handleReloadTheirs = useCallback(async () => {
    gizmoControllerRef.current?.detach();
    try {
      if (await reloadLayout()) editor.clear();
      else showStudioMessage('This layout was deleted in another tab', true);
    } catch (err) {
      showStudioMessage(err.message, true); // AHDUS: the server could not be reached, or no longer allows it
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- gizmoControllerRef is a useRef passed in (stable)
  }, [editor, showStudioMessage]);
  // Backup until there is a server: this layout as a file, or a file added to the layouts
  const handleExportLayout = useCallback(async () => {
    const { companyId, layoutId } = useWorkspaceStore.getState();
    try {
      const { fileName, text } = await exportLayout(companyId, layoutId);
      downloadText(fileName, text);
      showStudioMessage(`Downloaded ${fileName}`);
    } catch (err) {
      showStudioMessage(err.message, true);
    }
  }, [showStudioMessage]);
  const handleImportLayout = useCallback(async (file) => {
    try {
      if (isAhdusBackendOn()) {
        // A workplace in AHDUS is one site: the file replaces its layout (Ctrl+Z brings it back)
        const layout = readLayoutFile(await file.text());
        const res = editor.restoreVersion(layout);
        if (res?.problem) showStudioMessage(res.problem, true);
        else showStudioMessage(`Loaded "${layout.layoutName}" into this workplace. Press Ctrl+Z to undo.`);
        return;
      }
      const { name } = await importLayout(useWorkspaceStore.getState().companyId, await file.text());
      showStudioMessage(`Added "${name}" to your layouts`);
    } catch (err) {
      showStudioMessage(err.message, true);
    }
  }, [editor, showStudioMessage]);
  const handlePublish = useCallback(async () => {
    const res = await publishLayout();
    if (res.ok) showStudioMessage('Published: employees now see this version');
    else if (!res.conflict) showStudioMessage(`Not published: ${res.error}`, true);
  }, [showStudioMessage]);
  const handleSaveCopy = useCallback(async () => {
    const result = await saveAsCopy();
    if (result.ok) showStudioMessage(`Saved as "${useWorkspaceStore.getState().layoutName}"`);
  }, [showStudioMessage]);

  // ─── Floor plan export (PNG / PDF) ───
  const handleExportPng = useCallback(async () => {
    const { rooms, objects, floors, currentFloor } = useWorkspaceStore.getState();
    const floorName = floors[currentFloor]?.name ?? `Floor ${currentFloor}`;
    setExportLoading(true);
    const result = await exportFloorPlanAsPng({ rooms, objects, floors, floorId: currentFloor, floorName });
    setExportLoading(false);
    if (!result.ok) showStudioMessage(result.error, true);
    else showStudioMessage(`Exported ${floorName} as PNG`);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setExportLoading is a state setter passed in (stable)
  }, [showStudioMessage]);

  const handleExportPdf = useCallback(async () => {
    const { rooms, objects, floors, currentFloor } = useWorkspaceStore.getState();
    const floorName = floors[currentFloor]?.name ?? `Floor ${currentFloor}`;
    setExportLoading(true);
    const result = await exportFloorPlanAsPdf({ rooms, objects, floors, floorId: currentFloor, floorName });
    setExportLoading(false);
    if (!result.ok) showStudioMessage(result.error, true);
    else showStudioMessage(`Exported ${floorName} as PDF`);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setExportLoading is a state setter passed in (stable)
  }, [showStudioMessage]);

  const handlePhotoReconstruct = useCallback(async (file) => {
    const { companyId, layoutId, setReconstructing, setProposedLayout } = useWorkspaceStore.getState();
    if (!isPhotoReconstructionOn()) {
      showStudioMessage(RECONSTRUCTION_OFF, true);
      return;
    }
    if (!companyId || !layoutId) {
      showStudioMessage('Please open a company workspace first', true);
      return;
    }
    setReconstructing(true);
    showStudioMessage('Uploading photo to tenant storage…');
    const uploadRes = await uploadReconstructionPhoto(file, { companyId, layoutId });
    if (!uploadRes.ok) {
      setReconstructing(false, uploadRes.error);
      showStudioMessage(`Upload failed: ${uploadRes.error}`, true);
      return;
    }

    showStudioMessage('Analyzing photo with AI reconstruction…');
    const analysisRes = await requestPhotoAnalysis(uploadRes.storagePath, { companyId, layoutId });
    if (!analysisRes.ok) {
      setReconstructing(false, analysisRes.error);
      showStudioMessage(`AI reconstruction failed: ${analysisRes.error}`, true);
      return;
    }

    const stageRes = await stageProposedLayout({
      companyId,
      layoutId,
      storagePath: uploadRes.storagePath,
      proposedLayout: analysisRes.proposedLayout,
      detectionStats: analysisRes.detectionStats,
    });

    setProposedLayout({
      proposalId: stageRes.proposalId || null,
      storagePath: uploadRes.storagePath,
      layout: analysisRes.proposedLayout,
      detectionStats: analysisRes.detectionStats,
      stagedAt: new Date().toISOString(),
    });
    showStudioMessage('AI Proposed layout ready for your review');
  }, [showStudioMessage]);

  return {
    handleAllLayouts,
    handleReloadTheirs,
    handleExportLayout,
    handleImportLayout,
    handleSaveCopy,
    handlePublish,
    handleExportPng,
    handleExportPdf,
    handlePhotoReconstruct,
  };
}
