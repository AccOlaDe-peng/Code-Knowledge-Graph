import React from 'react';
import { useSigma } from '@react-sigma/core';

interface GraphControlsProps {
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onResetView?: () => void;
  onToggleLabels?: () => void;
}

export function GraphControls({
  onZoomIn,
  onZoomOut,
  onResetView,
  onToggleLabels,
}: GraphControlsProps) {
  const sigma = useSigma();

  const handleZoomIn = () => {
    const camera = sigma.getCamera();
    camera.animatedZoom({ duration: 300 });
    onZoomIn?.();
  };

  const handleZoomOut = () => {
    const camera = sigma.getCamera();
    camera.animatedUnzoom({ duration: 300 });
    onZoomOut?.();
  };

  const handleResetView = () => {
    const camera = sigma.getCamera();
    camera.animatedReset({ duration: 500 });
    onResetView?.();
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 20,
        right: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        zIndex: 1000,
      }}
    >
      <button
        onClick={handleZoomIn}
        style={buttonStyle}
        title="Zoom In"
      >
        +
      </button>
      <button
        onClick={handleZoomOut}
        style={buttonStyle}
        title="Zoom Out"
      >
        −
      </button>
      <button
        onClick={handleResetView}
        style={buttonStyle}
        title="Reset View"
      >
        ⟲
      </button>
      {onToggleLabels && (
        <button
          onClick={onToggleLabels}
          style={buttonStyle}
          title="Toggle Labels"
        >
          🏷
        </button>
      )}
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  width: '40px',
  height: '40px',
  borderRadius: '50%',
  border: '1px solid #ccc',
  background: 'white',
  cursor: 'pointer',
  fontSize: '20px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  transition: 'all 0.2s',
};
