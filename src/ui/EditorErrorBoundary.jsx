/**
 * ui/EditorErrorBoundary.jsx
 *
 * Wraps the editor. If it fails to render (a bad save, a bug in scene setup),
 * show a message with "Back to layouts" (backLabel: "Back to AHDUS" there)
 * instead of a blank page (and "Try again" with onRetry), log the error to the
 * console and tell onError (App hides its loading screen).
 */

import { Component } from 'react';
import { AlertTriangle, ArrowLeft, RotateCcw } from 'lucide-react';
import './overlays.css';

export default class EditorErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[AHDUS] The layout could not be opened:', error, info?.componentStack ?? '');
    this.props.onError?.(error); // App hides its loading screen: this card shows instead
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="editor-error" role="alert">
        <div className="editor-error__card">
          <AlertTriangle size={28} strokeWidth={1.75} aria-hidden className="editor-error__icon" />
          <h1 className="editor-error__title">This layout could not be opened</h1>
          <p className="editor-error__text">
            Something went wrong while opening it. Your saved layout has not been changed.
          </p>
          <p className="editor-error__detail ui-muted">{String(error?.message ?? error)}</p>
          <div className="studio-splash__actions">
            <button className="ui-btn is-primary" onClick={this.props.onBack}>
              <ArrowLeft size={16} strokeWidth={1.75} aria-hidden /> {this.props.backLabel ?? 'Back to layouts'}
            </button>
            {this.props.onRetry && (
              <button className="ui-btn" onClick={this.props.onRetry}>
                <RotateCcw size={16} strokeWidth={1.75} aria-hidden /> Try again
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
}
