import { useEffect, useMemo, useRef } from 'react';
import { projectPoint } from './projection';
import { wallMeasurementSegments } from '../utils/measurements';

export default function MeasurementOverlay({
  scene,
  rooms,
  objects,
  elevation,
  showWallLengths,
  measurements,
  measureStart,
  preview,
  currentFloor,
  hidden,
}) {
  const wallRefs = useRef(new Map());
  const measurementRefs = useRef(new Map());
  const lineRefs = useRef(new Map());
  const previewRef = useRef(null);
  const previewLineRef = useRef(null);
  const startMarkerRef = useRef(null);
  const pendingLabelRef = useRef(null);
  const currentPreviewRef = useRef(preview);
  const currentStartRef = useRef(measureStart);
  currentPreviewRef.current = preview;
  currentStartRef.current = measureStart;
  const walls = useMemo(
    () => showWallLengths ? wallMeasurementSegments(rooms, objects) : [],
    [rooms, objects, showWallLengths]
  );
  const floorMeasurements = useMemo(
    () => measurements.filter((measurement) => measurement.floor === currentFloor),
    [measurements, currentFloor]
  );

  useEffect(() => {
    if (!scene || hidden) return undefined;
    const place = () => {
      walls.forEach((wall, index) => {
        const label = wallRefs.current.get(index);
        if (!label) return;
        const point = projectPoint(scene, wall.midpoint.x, elevation + 0.12, wall.midpoint.z);
        label.style.visibility = point.visible ? 'visible' : 'hidden';
        label.style.transform = `translate(${Math.round(point.x)}px, ${Math.round(point.y)}px) translate(-50%, -50%)`;
      });

      floorMeasurements.forEach((measurement) => {
        const element = measurementRefs.current.get(measurement.id);
        if (!element) return;
        const midpoint = {
          x: (measurement.a.x + measurement.b.x) / 2,
          z: (measurement.a.z + measurement.b.z) / 2,
        };
        const point = projectPoint(scene, midpoint.x, elevation + 0.2, midpoint.z);
        element.style.visibility = point.visible ? 'visible' : 'hidden';
        element.style.transform = `translate(${Math.round(point.x)}px, ${Math.round(point.y)}px) translate(-50%, -50%)`;

        const group = lineRefs.current.get(measurement.id);
        if (group) positionLine(scene, group, measurement.a, measurement.b, elevation + 0.2);
      });

      const livePreview = previewRef.current;
      if (livePreview) {
        const point = projectPoint(scene, livePreview.x, elevation + 0.2, livePreview.z);
        livePreview.style.visibility = point.visible ? 'visible' : 'hidden';
        livePreview.style.transform = `translate(${Math.round(point.x)}px, ${Math.round(point.y)}px) translate(-50%, -50%)`;
      }
      const activePreview = currentPreviewRef.current;
      if (activePreview && previewLineRef.current) {
        positionLine(scene, previewLineRef.current, activePreview.a, activePreview.b, elevation + 0.2);
      }
      const activeStart = currentStartRef.current;
      if (activeStart && startMarkerRef.current) {
        const point = projectPoint(scene, activeStart.x, elevation + 0.2, activeStart.z);
        startMarkerRef.current.setAttribute('cx', point.x);
        startMarkerRef.current.setAttribute('cy', point.y);
        startMarkerRef.current.style.visibility = point.visible ? 'visible' : 'hidden';
        if (pendingLabelRef.current) {
          pendingLabelRef.current.style.visibility = point.visible ? 'visible' : 'hidden';
          pendingLabelRef.current.style.transform =
            `translate(${Math.round(point.x)}px, ${Math.round(point.y)}px) translate(-50%, calc(-100% - 10px))`;
        }
      }
    };
    const observer = scene.onAfterRenderObservable.add(place);
    return () => scene.onAfterRenderObservable.remove(observer);
  }, [scene, walls, floorMeasurements, elevation, hidden]);

  if (hidden) return null;
  return (
    <div className="measurement-overlays" aria-live="polite">
      {walls.map((wall, index) => (
        <span
          key={`wall-${index}`}
          className="measurement-label measurement-label--wall"
          ref={(element) => {
            if (element) wallRefs.current.set(index, element);
            else wallRefs.current.delete(index);
          }}
        >
          {wall.length.toFixed(2)} m
        </span>
      ))}
      {floorMeasurements.map((measurement) => (
        <span
          key={measurement.id}
          className="measurement-label measurement-label--distance"
          ref={(element) => {
            if (element) measurementRefs.current.set(measurement.id, element);
            else measurementRefs.current.delete(measurement.id);
          }}
        >
          Distance: {measurement.length.toFixed(2)} m
        </span>
      ))}
      {preview && (
        <span
          className="measurement-label measurement-label--distance"
          ref={(element) => { previewRef.current = element; }}
        >
          Distance: {preview.length.toFixed(2)} m
        </span>
      )}
      {measureStart && (
        <span
          className="measurement-label measurement-label--distance measurement-label--pending"
          ref={(element) => { pendingLabelRef.current = element; }}
        >
          Choose the second point
        </span>
      )}
      <svg className="measurement-lines" aria-hidden="true">
        {floorMeasurements.map((measurement) => {
          return (
            <g key={measurement.id} ref={(element) => {
              if (element) lineRefs.current.set(measurement.id, element);
              else lineRefs.current.delete(measurement.id);
            }}>
              <line />
              <circle r="4" />
              <circle r="4" />
            </g>
          );
        })}
        {preview && <g className="measurement-lines__preview" ref={(element) => { previewLineRef.current = element; }}>
          <line />
          <circle r="4" />
        </g>}
        {measureStart && <circle className="measurement-lines__start" r="5" ref={(element) => { startMarkerRef.current = element; }} />}
      </svg>
    </div>
  );
}

function positionLine(scene, group, a, b, y) {
  const start = projectPoint(scene, a.x, y, a.z);
  const end = projectPoint(scene, b.x, y, b.z);
  group.style.visibility = start.visible && end.visible ? 'visible' : 'hidden';
  const line = group.querySelector('line');
  const circles = group.querySelectorAll('circle');
  line?.setAttribute('x1', start.x);
  line?.setAttribute('y1', start.y);
  line?.setAttribute('x2', end.x);
  line?.setAttribute('y2', end.y);
  circles[0]?.setAttribute('cx', start.x);
  circles[0]?.setAttribute('cy', start.y);
  circles[1]?.setAttribute('cx', end.x);
  circles[1]?.setAttribute('cy', end.y);
}
