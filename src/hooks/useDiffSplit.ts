import { type CSSProperties, useState } from 'react';

import { useResize } from './useResize.js';

export function useDiffSplit() {
  const [ratio, setRatio] = useState(50);
  const onMouseDown = useResize({
    start: (event) => {
      const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
      return bounds?.width
        ? {
            value: (next) =>
              ((next.clientX - bounds.left) / bounds.width) * 100,
            min: 20,
            max: 80,
          }
        : null;
    },
    onChange: setRatio,
  });
  return {
    style: {
      '--svn-diff-left': ratio,
      '--svn-diff-right': 100 - ratio,
    } as CSSProperties,
    onMouseDown,
  };
}
