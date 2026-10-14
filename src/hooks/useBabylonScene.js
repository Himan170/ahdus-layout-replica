import { useRef, useEffect } from 'react';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Color4 } from '@babylonjs/core/Maths/math.color';

/**
 * Custom hook: creates and manages a Babylon.js Engine + Scene
 * attached to a <canvas> ref.
 *
 * Usage:
 *   const canvasRef = useRef(null);
 *   const { sceneRef, engineRef } = useBabylonScene(canvasRef);
 *
 * The refs are stable across renders. Access .current to get the
 * live Engine / Scene once the canvas has mounted.
 */
export function useBabylonScene(canvasRef) {
  const engineRef = useRef(null);
  const sceneRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // --- Create Engine ---
    const engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
    });
    engine.setHardwareScalingLevel(1 / window.devicePixelRatio);

    // --- Create Scene ---
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.05, 0.07, 0.1, 1); // dark blue-grey

    engineRef.current = engine;
    sceneRef.current = scene;

    // --- Render loop ---
    engine.runRenderLoop(() => {
      scene.render();
    });

    // --- Window resize ---
    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);

    // --- Cleanup ---
    return () => {
      window.removeEventListener('resize', onResize);
      engine.stopRenderLoop();
      scene.dispose();
      engine.dispose();
      engineRef.current = null;
      sceneRef.current = null;
    };
  }, []); // runs once on mount

  return { sceneRef, engineRef };
}
