import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';

/**
 * PipPopup Component
 * Uses React Portals to render content into the Picture-in-Picture window.
 */
export default function PipPopup({ pipWindow, children }) {
  const [container, setContainer] = useState(null);

  useEffect(() => {
    if (!pipWindow) return;

    // Create a container element in the PiP window
    const doc = pipWindow.document;
    const newContainer = doc.createElement('div');
    newContainer.id = 'pip-root';
    doc.body.appendChild(newContainer);
    
    // Copy styles from main window to PiP window
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach((style) => {
      doc.head.appendChild(style.cloneNode(true));
    });

    // Set body styles for PiP
    doc.body.style.margin = '0';
    doc.body.style.overflow = 'hidden';
    doc.body.style.backgroundColor = '#111827'; // gray-900

    setContainer(newContainer);

    return () => {
      if (newContainer && doc.body.contains(newContainer)) {
        doc.body.removeChild(newContainer);
      }
    };
  }, [pipWindow]);

  if (!container) return null;

  return createPortal(children, container);
}
