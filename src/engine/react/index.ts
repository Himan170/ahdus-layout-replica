/**
 * engine/react — React components for the layout engine (docs/LAYOUT_ENGINE_API.md 2.1)
 *
 *   import { LayoutViewer, LayoutEditor } from '@engine/react';
 *
 * LayoutViewer loads no Workplace Studio code; LayoutEditor loads Studio
 * only when it shows one (mode "edit").
 */

export { LayoutViewer } from './LayoutViewer';
export type { LayoutViewerProps } from './LayoutViewer';
export { LayoutEditor } from './LayoutEditor';
export type { LayoutEditorProps, StudioHandle } from './LayoutEditor';
