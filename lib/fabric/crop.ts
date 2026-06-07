interface Size {
  width: number;
  height: number;
}

interface CropFrame extends Size {
  cropX: number;
  cropY: number;
  scale: number;
}

interface CropPanInput {
  initialCropX: number;
  initialCropY: number;
  deltaX: number;
  deltaY: number;
  angle: number;
  scaleX: number;
  scaleY: number;
  original: Size;
  frame: Size;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function calculateCropFrame(
  original: Size,
  aspect: number,
  currentDisplay: Size,
): CropFrame {
  let width = original.width;
  let height = original.height;

  if (original.width / original.height > aspect) {
    width = original.height * aspect;
  } else {
    height = original.width / aspect;
  }

  return {
    width,
    height,
    cropX: (original.width - width) / 2,
    cropY: (original.height - height) / 2,
    scale: Math.sqrt(
      (currentDisplay.width * currentDisplay.height) /
        Math.max(width * height, 1),
    ),
  };
}

export function calculateCropPan({
  initialCropX,
  initialCropY,
  deltaX,
  deltaY,
  angle,
  scaleX,
  scaleY,
  original,
  frame,
}: CropPanInput) {
  const radians = (angle * Math.PI) / 180;
  const localX = deltaX * Math.cos(radians) + deltaY * Math.sin(radians);
  const localY = -deltaX * Math.sin(radians) + deltaY * Math.cos(radians);

  return {
    cropX: clamp(
      initialCropX - localX / Math.max(Math.abs(scaleX), 0.001),
      0,
      Math.max(original.width - frame.width, 0),
    ),
    cropY: clamp(
      initialCropY - localY / Math.max(Math.abs(scaleY), 0.001),
      0,
      Math.max(original.height - frame.height, 0),
    ),
  };
}
