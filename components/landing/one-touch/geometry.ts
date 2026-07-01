import type { PanelMotion, Point, Viewport } from "./config";

export const polygonPath = (sides: number, radius: number, rotation = -90) => {
  const points = Array.from({ length: sides }, (_, index) => {
    const angle = ((rotation + (360 / sides) * index) * Math.PI) / 180;
    return [
      50 + Math.cos(angle) * radius,
      50 + Math.sin(angle) * radius,
    ];
  });

  return `${points
    .map(
      ([x, y], index) =>
        `${index === 0 ? "M" : "L"} ${x.toFixed(3)} ${y.toFixed(3)}`,
    )
    .join(" ")} Z`;
};

export const starPath = (
  points: number,
  outerRadius: number,
  innerRadius: number,
) => {
  const vertices = Array.from({ length: points * 2 }, (_, index) => {
    const angle = ((-90 + (360 / (points * 2)) * index) * Math.PI) / 180;
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    return [
      50 + Math.cos(angle) * radius,
      50 + Math.sin(angle) * radius,
    ];
  });

  return `${vertices
    .map(
      ([x, y], index) =>
        `${index === 0 ? "M" : "L"} ${x.toFixed(3)} ${y.toFixed(3)}`,
    )
    .join(" ")} Z`;
};

export const getViewportEdgePoint = (
  viewport: Viewport,
  angle: number,
  center: Point,
) => {
  const centerX = center.x;
  const centerY = center.y;
  const radians = (angle * Math.PI) / 180;
  const directionX = Math.cos(radians);
  const directionY = Math.sin(radians);
  const distances: number[] = [];

  if (Math.abs(directionX) > 0.0001) {
    const edgeX = directionX > 0 ? viewport.width + 4 : -4;
    const distanceX = (edgeX - centerX) / directionX;
    if (distanceX > 0) {
      distances.push(distanceX);
    }
  }

  if (Math.abs(directionY) > 0.0001) {
    const edgeY = directionY > 0 ? viewport.height + 4 : -4;
    const distanceY = (edgeY - centerY) / directionY;
    if (distanceY > 0) {
      distances.push(distanceY);
    }
  }

  const distance = Math.min(...distances);
  return {
    x: centerX + directionX * distance,
    y: centerY + directionY * distance,
  };
};

export const normalizeAngle = (angle: number) =>
  ((angle % 360) + 360) % 360;

export const getPanelMotions = (
  viewport: Viewport,
  angles: readonly number[],
  center: Point,
): PanelMotion[] => {
  const centerX = center.x;
  const centerY = center.y;
  const radius = Math.hypot(viewport.width, viewport.height) * 1.6;
  const sortedAngles = [...angles].map(normalizeAngle).sort((a, b) => a - b);

  return sortedAngles.map((startAngle, index) => {
    let endAngle = sortedAngles[(index + 1) % sortedAngles.length];
    if (endAngle <= startAngle) {
      endAngle += 360;
    }

    const sweep = endAngle - startAngle;
    const pointCount = Math.max(2, Math.ceil(sweep / 24));
    const arcPoints = Array.from({ length: pointCount + 1 }, (_, pointIndex) => {
      const angle =
        startAngle + (sweep * pointIndex) / Math.max(1, pointCount);
      const radians = (angle * Math.PI) / 180;
      return `${(centerX + Math.cos(radians) * radius).toFixed(2)}px ${(centerY + Math.sin(radians) * radius).toFixed(2)}px`;
    });
    const middleRadians = ((startAngle + sweep / 2) * Math.PI) / 180;

    return {
      clipPath: `polygon(${centerX.toFixed(2)}px ${centerY.toFixed(2)}px, ${arcPoints.join(", ")})`,
      x: Math.cos(middleRadians),
      y: Math.sin(middleRadians),
    };
  });
};

export const getInnerCutPath = (angle: number) => {
  const radians = (angle * Math.PI) / 180;
  const x = 50 + Math.cos(radians) * 48;
  const y = 50 + Math.sin(radians) * 48;
  return `M 50 50 L ${x.toFixed(3)} ${y.toFixed(3)}`;
};
