/* =========================================================
   EDGE COIN — game engine
   A top-down coin arena. Aim with the mouse, hold to charge,
   and knock every rival past the rim. No walls. No respawns.
   ========================================================= */
(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const ARENA_BASE_RADIUS = 600;
  const ARENA_MIN_SIZE = 0.7;
  const ARENA_MAX_SIZE = 3;
  const ARENA_DEFAULT_TURN_LIMIT = 12;
  const ARENA_DEFAULT_SHRINK_RATE = 6;
  const ARENA_MAX_TURN_LIMIT = 30;
  const ARENA_MIN_SHRINK_FACTOR = 0.18;
  const ARENA_TEXTURE_EXTENT = ARENA_BASE_RADIUS * ARENA_MAX_SIZE + 110;
  let R = ARENA_BASE_RADIUS;
  const CHARGE_TIME = 1.05;
  const MAX_SUBSTEPS = 7;
  const PAN_SPEED = 520;
  const PAN_MARGIN_PX = 220;
  const PAN_KEY_MAP = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
  };

  const AI_DIFFICULTIES = {
    easy: {
      id: 'easy',
      label: '轻松',
      note: '轻松 · AI 瞄准更随意，失误更多，出手也更慢。',
      aimError: 2.0,
      waitMin: 0.9,
      waitMax: 1.45,
      aimDuration: 1.2,
      playerBias: 0.45,
      edgeBias: 0.6,
      noise: 1.55,
      powerMargin: 0.05,
      powerRandom: 0.22,
      blunderChance: 0.3,
      blunderAmount: 0.24,
      volleyLockMin: 1.5,
      volleyLockMax: 2.8,
    },
    normal: {
      id: 'normal',
      label: '标准',
      note: '标准 · AI 会认真瞄准，但偶尔失手。',
      aimError: 1,
      waitMin: 0.48,
      waitMax: 0.85,
      aimDuration: 1.05,
      playerBias: 1,
      edgeBias: 1,
      noise: 1,
      powerMargin: 0.08,
      powerRandom: 0.12,
      blunderChance: 0.16,
      blunderAmount: 0.16,
      volleyLockMin: 0.8,
      volleyLockMax: 1.7,
    },
    hard: {
      id: 'hard',
      label: '困难',
      note: '困难 · AI 更精准、更果断，也更会针对边缘。',
      aimError: 0.5,
      waitMin: 0.28,
      waitMax: 0.5,
      aimDuration: 0.82,
      playerBias: 1.3,
      edgeBias: 1.25,
      noise: 0.55,
      powerMargin: 0.05,
      powerRandom: 0.06,
      blunderChance: 0.04,
      blunderAmount: 0.08,
      volleyLockMin: 0.35,
      volleyLockMax: 0.8,
    },
  };
  const storedDifficulty = safeStorageGet('edgecoin.difficulty');
  const INITIAL_DIFFICULTY = AI_DIFFICULTIES[storedDifficulty] ? storedDifficulty : 'normal';

  const ARENA_SHAPES = {
    circle: {
      id: 'circle',
      name: '圆桌',
      en: 'CIRCLE',
      edge: '连续无棱角',
      desc: '边界连续，没有死角。碰撞后的滑行方向最难预测。',
    },
    square: {
      id: 'square',
      name: '方阵',
      en: 'SQUARE',
      edge: '4 条直边',
      desc: '四条直边制造折返与夹击角度，角落是危险区。',
      points: [[-1, -1], [1, -1], [1, 1], [-1, 1]],
    },
    hex: {
      id: 'hex',
      name: '六边',
      en: 'HEXAGON',
      edge: '6 条直边',
      desc: '六个斜切角，适合把对手逼向侧边再送出界。',
      points: [
        [0, -1], [0.866, -0.5], [0.866, 0.5],
        [0, 1], [-0.866, 0.5], [-0.866, -0.5],
      ],
    },
    octagon: {
      id: 'octagon',
      name: '八边',
      en: 'OCTAGON',
      edge: '8 条直边',
      desc: '接近圆桌但更具方向性，八个斜面提供缓冲角度。',
      points: [
        [1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071],
        [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071],
      ],
    },
    diamond: {
      id: 'diamond',
      name: '菱阵',
      en: 'DIAMOND',
      edge: '4 个尖角',
      desc: '四个尖角指向上下左右，中心到四角的距离最长。',
      points: [[0, -1], [1, 0], [0, 1], [-1, 0]],
    },
  };

  const OBSTACLE_SHAPES = {
    circle: { id: 'circle', name: '圆形', sides: 0 },
    square: { id: 'square', name: '方形', sides: 4 },
    rectangle: { id: 'rectangle', name: '长方形', sides: 4, rectangle: true },
    triangle: { id: 'triangle', name: '三角', sides: 3 },
  };
  const OBSTACLE_MAX_COUNT = 12;
  const DEFAULT_OBSTACLE_CONFIG = {
    count: 4,
    fixed: true,
    movable: true,
    shapes: ['circle', 'square', 'rectangle', 'triangle'],
    placement: 'random',
    items: [],
  };

  function sanitizeCustomObstacleItems(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, OBSTACLE_MAX_COUNT).map((item, index) => {
      const shape = OBSTACLE_SHAPES[item && item.shape] ? item.shape : 'circle';
      const type = item && item.type === 'movable' ? 'movable' : 'fixed';
      const size = Math.min(18, Math.max(2.5, Number(item && item.size) || 8));
      let x = Math.min(0.84, Math.max(-0.84, Number(item && item.x) || 0));
      let y = Math.min(0.84, Math.max(-0.84, Number(item && item.y) || 0));
      const maxDistance = Math.max(0.05, 0.82 - size / 100);
      const distance = Math.hypot(x, y);
      if (distance > maxDistance) {
        x = x / distance * maxDistance;
        y = y / distance * maxDistance;
      }
      return {
        id: `custom-${index + 1}`,
        shape,
        type,
        x,
        y,
        size,
        rot: Number(item && item.rot) || 0,
      };
    });
  }

  function sanitizeObstacleConfig(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const count = Math.min(OBSTACLE_MAX_COUNT, Math.max(0, Math.round(Number(source.count) || 0)));
    const shapes = Array.isArray(source.shapes)
      ? source.shapes.filter((id, index, list) => OBSTACLE_SHAPES[id] && list.indexOf(id) === index)
      : DEFAULT_OBSTACLE_CONFIG.shapes.slice();
    const fixed = source.fixed === undefined ? DEFAULT_OBSTACLE_CONFIG.fixed : !!source.fixed;
    const movable = source.movable === undefined ? DEFAULT_OBSTACLE_CONFIG.movable : !!source.movable;
    const safeShapes = shapes.length ? shapes : ['circle'];
    const customItems = sanitizeCustomObstacleItems(source.items);
    const placement = source.placement === 'custom' ? 'custom' : 'random';
    const effectiveItems = placement === 'custom' && count > 0
      ? customItems.slice(0, count)
      : customItems;
    return {
      count: placement === 'custom'
        ? (count > 0 ? Math.min(count, effectiveItems.length) : 0)
        : count,
      fixed: fixed || (!fixed && !movable),
      movable,
      shapes: safeShapes,
      placement,
      items: effectiveItems,
    };
  }

  function obstacleSeed(config) {
    let seed = 0x9e3779b9;
    seed ^= (config.count || 0) * 2654435761;
    seed ^= (config.fixed ? 17 : 0) + (config.movable ? 31 : 0);
    (config.shapes || []).forEach((shape, index) => {
      seed ^= (shape.charCodeAt(0) + index * 73) * 2654435761;
    });
    return seed >>> 0;
  }

  function obstacleRandom(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  function buildObstacleLayout(radius, config, options = {}) {
    const safe = sanitizeObstacleConfig(config);
    if (safe.count <= 0) return [];
    if (safe.placement === 'custom' && safe.items.length) {
      return safe.items.map((item, index) => {
        const obstacleRadius = radius * item.size / 100;
        const angle = Math.atan2(item.y, item.x);
        const boundary = getArenaBoundaryAtAngle(angle);
        const boundaryNorm = boundary ? Math.hypot(boundary.x, boundary.y) / Math.max(1, R) : 1;
        const maxDistance = Math.max(0.04, boundaryNorm - item.size / 100 - 0.02);
        const distance = Math.hypot(item.x, item.y);
        const nx = distance > maxDistance ? item.x / distance * maxDistance : item.x;
        const ny = distance > maxDistance ? item.y / distance * maxDistance : item.y;
        return {
          id: `obstacle-${index + 1}`,
          shape: item.shape,
          type: item.type,
          movable: item.type === 'movable',
          x: nx * radius,
          y: ny * radius,
          vx: 0,
          vy: 0,
          radius: obstacleRadius,
          mass: item.type === 'movable' ? 2.4 + item.size * 0.08 : 0,
          rot: item.rot,
          spin: 0,
          flash: 0,
        };
      });
    }
    const types = [];
    if (safe.fixed) types.push('fixed');
    if (safe.movable) types.push('movable');
    const shapeIds = safe.shapes.filter((id) => OBSTACLE_SHAPES[id]);
    if (!types.length || !shapeIds.length) return [];
    const preview = !!options.preview;
    const random = preview
      ? obstacleRandom(obstacleSeed(safe))
      : Math.random;
    const actualCoins = preview ? [] : G.coins.filter((coin) => coin.alive);
    const minDist = radius * 0.12;
    const maxDist = radius * (preview ? 0.56 : 0.58);
    const obstacles = [];
    for (let i = 0; i < safe.count; i += 1) {
      const type = types[Math.floor(random() * types.length)];
      const shape = shapeIds[Math.floor(random() * shapeIds.length)];
      let obstacleRadius = radius * (0.058 + random() * 0.03);
      obstacleRadius = clamp(obstacleRadius, 22, radius * 0.14);
      let x = 0;
      let y = 0;
      let placed = false;
      for (let attempt = 0; attempt < 90; attempt += 1) {
        const angle = random() * TAU;
        const distance = minDist + random() * Math.max(0, maxDist - minDist);
        const px = Math.cos(angle) * distance;
        const py = Math.sin(angle) * distance;
        if (!preview) {
          const boundary = getArenaBoundaryAtAngle(angle);
          const boundaryDistance = boundary ? Math.hypot(boundary.x, boundary.y) : radius;
          if (distance + obstacleRadius > boundaryDistance - 16) continue;
        }
        let overlaps = false;
        for (const other of obstacles) {
          if (Math.hypot(px - other.x, py - other.y) < obstacleRadius + other.radius + 14) {
            overlaps = true;
            break;
          }
        }
        if (overlaps) continue;
        for (const coin of actualCoins) {
          if (Math.hypot(px - coin.x, py - coin.y) < obstacleRadius + coin.radius + 10) {
            overlaps = true;
            break;
          }
        }
        if (overlaps) continue;
        x = px;
        y = py;
        placed = true;
        break;
      }
      if (!placed) {
        const angle = (i / safe.count) * TAU + random() * 0.4;
        const distance = radius * 0.34;
        x = Math.cos(angle) * distance;
        y = Math.sin(angle) * distance;
      }
      obstacles.push({
        id: `obstacle-${i + 1}`,
        shape,
        type,
        movable: type === 'movable',
        x,
        y,
        vx: 0,
        vy: 0,
        radius: obstacleRadius,
        mass: type === 'movable' ? 2.4 + random() * 2.2 : 0,
        rot: random() * TAU,
        spin: 0,
        flash: 0,
      });
    }
    return obstacles;
  }

  function resetMatchObstacles() {
    if (G.mode === 'chase') {
      G.obstacles = [];
      return;
    }
    if (G.online && G.online.active && G.online.role !== 'host') {
      G.obstacles = [];
      return;
    }
    G.obstacles = buildObstacleLayout(R, G.arena.obstacles, { preview: false });
    G.arenaObstaclePreview = null;
  }

  function pruneObstacles() {
    if (!G.obstacles.length) return;
    G.obstacles = G.obstacles.filter((obstacle) => {
      const angle = Math.atan2(obstacle.y, obstacle.x);
      const boundary = getArenaBoundaryAtAngle(angle);
      const boundaryDistance = boundary ? Math.hypot(boundary.x, boundary.y) : R;
      return Math.hypot(obstacle.x, obstacle.y) + obstacle.radius * 0.9 <= boundaryDistance + 2;
    });
  }

  function createDefaultWalls() {
    const walls = {};
    Object.values(ARENA_SHAPES).forEach((shape) => {
      if (shape.points) walls[shape.id] = new Array(shape.points.length).fill(false);
    });
    return walls;
  }

  function sanitizeWalls(raw) {
    const walls = createDefaultWalls();
    if (!raw || typeof raw !== 'object') return walls;
    Object.keys(walls).forEach((shapeId) => {
      const source = raw[shapeId];
      if (!Array.isArray(source)) return;
      walls[shapeId] = walls[shapeId].map((_, index) => !!source[index]);
      if (walls[shapeId].every(Boolean)) walls[shapeId][0] = false;
    });
    return walls;
  }

  function loadArenaConfig() {
    let parsed = null;
    try {
      parsed = JSON.parse(safeStorageGet('edgecoin.arena') || 'null');
    } catch (e) {
      parsed = null;
    }
    const shape = parsed && Object.prototype.hasOwnProperty.call(ARENA_SHAPES, parsed.shape)
      ? parsed.shape
      : 'circle';
    const rawSize = Number(parsed && parsed.size) || 1;
    const clamped = Math.min(ARENA_MAX_SIZE, Math.max(ARENA_MIN_SIZE, rawSize));
    const size = Math.round(clamped * 20) / 20;
    const walls = sanitizeWalls(parsed && parsed.walls);
    const storedLimit = parsed ? Number(parsed.turnLimit) : NaN;
    const turnLimit = Number.isFinite(storedLimit)
      ? Math.min(ARENA_MAX_TURN_LIMIT, Math.max(0, Math.round(storedLimit)))
      : ARENA_DEFAULT_TURN_LIMIT;
    const storedRate = parsed ? Number(parsed.shrinkRate) : NaN;
    const shrinkRate = Number.isFinite(storedRate)
      ? Math.min(15, Math.max(2, Math.round(storedRate)))
      : ARENA_DEFAULT_SHRINK_RATE;
    const obstacles = sanitizeObstacleConfig(
      parsed && parsed.obstacles ? parsed.obstacles : DEFAULT_OBSTACLE_CONFIG,
    );
    return { shape, size, walls, turnLimit, shrinkRate, obstacles };
  }

  const INITIAL_ARENA = loadArenaConfig();
  R = ARENA_BASE_RADIUS * INITIAL_ARENA.size;

  const PHYS = {
    drag: 1.08,
    rolling: 42,
    stop: 7,
    restitution: 0.93,
    tangent: 0.035,
  };

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const invLerp = (a, b, v) => (v - a) / (b - a);
  const smoothstep = (t) => {
    t = clamp(t, 0, 1);
    return t * t * (3 - 2 * t);
  };
  const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const distXY = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
  const angleTo = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
  const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const easeOutBack = (t) => {
    t = clamp(t, 0, 1);
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  };

  function rgba(hex, alpha) {
    const h = hex.replace('#', '');
    const n = h.length === 3
      ? h.split('').map((c) => c + c).join('')
      : h;
    const num = parseInt(n, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function mixColor(a, b, t) {
    const ah = a.replace('#', '');
    const bh = b.replace('#', '');
    const pa = parseInt(ah.length === 3 ? ah.split('').map((c) => c + c).join('') : ah, 16);
    const pb = parseInt(bh.length === 3 ? bh.split('').map((c) => c + c).join('') : bh, 16);
    const ar = (pa >> 16) & 255;
    const ag = (pa >> 8) & 255;
    const ab = pa & 255;
    const br = (pb >> 16) & 255;
    const bg = (pb >> 8) & 255;
    const bb = pb & 255;
    return `rgb(${Math.round(lerp(ar, br, t))},${Math.round(lerp(ag, bg, t))},${Math.round(lerp(ab, bb, t))})`;
  }

  function shade(hex, amount) {
    // amount > 0 lightens, amount < 0 darkens
    return amount >= 0 ? mixColor(hex, '#ffffff', amount) : mixColor(hex, '#000000', -amount);
  }

  function formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  /* =========================================================
     Arena geometry — circle + regular polygon playfields
     ========================================================= */
  function getArenaShape() {
    return Object.prototype.hasOwnProperty.call(ARENA_SHAPES, G.arena.shape)
      ? ARENA_SHAPES[G.arena.shape]
      : ARENA_SHAPES.circle;
  }

  function updateArenaRadius() {
    const shrink = clamp(Number(G.arena.shrink) || 1, ARENA_MIN_SHRINK_FACTOR, 1);
    G.arena.shrink = shrink;
    R = ARENA_BASE_RADIUS * G.arena.size * shrink;
  }

  function getArenaVertices(radius = R) {
    const shape = getArenaShape();
    if (!shape.points) return null;
    return shape.points.map(([x, y]) => ({ x: x * radius, y: y * radius }));
  }

  function getWallFlags(shapeId = G.arena.shape) {
    const shape = ARENA_SHAPES[shapeId];
    if (!shape || !shape.points) return null;
    const flags = G.arena.walls && G.arena.walls[shapeId];
    if (!Array.isArray(flags) || flags.length !== shape.points.length) {
      return new Array(shape.points.length).fill(false);
    }
    return flags;
  }

  function isWallEdge(index) {
    const flags = getWallFlags();
    return !!flags && !!flags[index];
  }

  function getArenaEdges(radius = R) {
    const shape = getArenaShape();
    if (!shape.points) return [];
    const verts = getArenaVertices(radius);
    const flags = getWallFlags();
    return verts.map((a, index) => {
      const b = verts[(index + 1) % verts.length];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const len = Math.hypot(ex, ey) || 1;
      let nx = -ey / len;
      let ny = ex / len;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      if (nx * mx + ny * my < 0) {
        nx = -nx;
        ny = -ny;
      }
      return {
        index,
        a,
        b,
        ex,
        ey,
        len,
        nx,
        ny,
        tx: ex / len,
        ty: ey / len,
        isWall: !!flags[index],
        midAngle: Math.atan2(my, mx),
      };
    });
  }

  function distanceToArenaOpenBoundary(x, y) {
    if (!getArenaShape().points) return R - Math.hypot(x, y);
    const verts = getArenaVertices(R);
    const inside = pointInPolygon(x, y, verts);
    let best = Infinity;
    for (const edge of getArenaEdges()) {
      if (edge.isWall) continue;
      const t = clamp(((x - edge.a.x) * edge.ex + (y - edge.a.y) * edge.ey) / (edge.len * edge.len), 0, 1);
      const px = edge.a.x + edge.ex * t;
      const py = edge.a.y + edge.ey * t;
      best = Math.min(best, Math.hypot(x - px, y - py));
    }
    return Number.isFinite(best) ? (inside ? best : -best) : 0;
  }

  function getNearestOpenBoundary(x, y) {
    const shape = getArenaShape();
    if (!shape.points) {
      const angle = Math.atan2(y, x);
      return getArenaBoundaryAtAngle(angle);
    }
    let best = null;
    let bestDist = Infinity;
    for (const edge of getArenaEdges()) {
      if (edge.isWall) continue;
      const t = clamp(((x - edge.a.x) * edge.ex + (y - edge.a.y) * edge.ey) / (edge.len * edge.len), 0, 1);
      const px = edge.a.x + edge.ex * t;
      const py = edge.a.y + edge.ey * t;
      const d = Math.hypot(x - px, y - py);
      if (d < bestDist) {
        bestDist = d;
        best = {
          x: px,
          y: py,
          nx: edge.nx,
          ny: edge.ny,
          tx: edge.tx,
          ty: edge.ty,
          edgeIndex: edge.index,
        };
      }
    }
    return best;
  }

  function traceArenaPath(ctx, radius = R) {
    ctx.beginPath();
    if (!getArenaShape().points) {
      ctx.arc(0, 0, radius, 0, TAU);
      return;
    }
    const verts = getArenaVertices(radius);
    ctx.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i += 1) ctx.lineTo(verts[i].x, verts[i].y);
    ctx.closePath();
  }

  function clipArenaPath(ctx, radius = R) {
    traceArenaPath(ctx, radius);
    ctx.clip();
  }

  function pointInPolygon(x, y, verts) {
    let inside = false;
    for (let i = 0, j = verts.length - 1; i < verts.length; j = i, i += 1) {
      const xi = verts[i].x;
      const yi = verts[i].y;
      const xj = verts[j].x;
      const yj = verts[j].y;
      const crosses = (yi > y) !== (yj > y)
        && x < ((xj - xi) * (y - yi)) / (yj - yi || 0.000001) + xi;
      if (crosses) inside = !inside;
    }
    return inside;
  }

  function isInsideArena(x, y, margin = 0) {
    if (!getArenaShape().points) return Math.hypot(x, y) <= R + margin;
    return pointInPolygon(x, y, getArenaVertices(R + margin));
  }

  function distanceToArenaBoundary(x, y) {
    const shape = getArenaShape();
    if (!shape.points) return R - Math.hypot(x, y);
    const verts = getArenaVertices(R);
    const inside = pointInPolygon(x, y, verts);
    let best = Infinity;
    for (let i = 0; i < verts.length; i += 1) {
      const a = verts[i];
      const b = verts[(i + 1) % verts.length];
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const lenSq = vx * vx + vy * vy;
      const t = clamp(((x - a.x) * vx + (y - a.y) * vy) / lenSq, 0, 1);
      best = Math.min(best, Math.hypot(x - (a.x + vx * t), y - (a.y + vy * t)));
    }
    return inside ? best : -best;
  }

  function getArenaDangerBand() {
    return Math.max(54, R * 0.2);
  }

  function getArenaBoundaryAtAngle(angle) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const shape = getArenaShape();
    if (!shape.points) {
      return {
        x: dx * R,
        y: dy * R,
        t: R,
        tx: -dy,
        ty: dx,
        nx: dx,
        ny: dy,
        edgeIndex: -1,
        isWall: false,
      };
    }
    const verts = getArenaVertices(R);
    let best = null;
    for (let i = 0; i < verts.length; i += 1) {
      const a = verts[i];
      const b = verts[(i + 1) % verts.length];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const denom = dx * ey - dy * ex;
      if (Math.abs(denom) < 1e-8) continue;
      const qx = a.x;
      const qy = a.y;
      const t = (qx * ey - qy * ex) / denom;
      const u = (qx * dy - qy * dx) / denom;
      if (t >= 0 && u >= -1e-5 && u <= 1 + 1e-5) {
        if (!best || t < best.t) {
          const len = Math.hypot(ex, ey) || 1;
          let nx = -ey / len;
          let ny = ex / len;
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          if (nx * mx + ny * my < 0) {
            nx = -nx;
            ny = -ny;
          }
          best = {
            x: dx * t,
            y: dy * t,
            t,
            tx: ex / len,
            ty: ey / len,
            nx,
            ny,
            edgeIndex: i,
            isWall: isWallEdge(i),
          };
        }
      }
    }
    return best;
  }

  function rayArenaIntersection(px, py, dx, dy, radius = R) {
    const shape = getArenaShape();
    if (!shape.points) {
      const b = px * dx + py * dy;
      const c = px * px + py * py - radius * radius;
      const disc = b * b - c;
      if (disc < 0) return null;
      const t = -b + Math.sqrt(disc);
      if (t < 0) return null;
      const x = px + dx * t;
      const y = py + dy * t;
      const len = Math.hypot(x, y) || 1;
      return { t, x, y, tx: -y / len, ty: x / len, nx: x / len, ny: y / len, edgeIndex: -1, isWall: false };
    }
    const verts = getArenaVertices(radius);
    let best = null;
    for (let i = 0; i < verts.length; i += 1) {
      const a = verts[i];
      const b = verts[(i + 1) % verts.length];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const denom = dx * ey - dy * ex;
      if (Math.abs(denom) < 1e-8) continue;
      const qx = a.x - px;
      const qy = a.y - py;
      const t = (qx * ey - qy * ex) / denom;
      const u = (qx * dy - qy * dx) / denom;
      if (t >= 0 && u >= -1e-5 && u <= 1 + 1e-5) {
        if (!best || t < best.t) {
          const len = Math.hypot(ex, ey) || 1;
          let nx = -ey / len;
          let ny = ex / len;
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          if (nx * mx + ny * my < 0) {
            nx = -nx;
            ny = -ny;
          }
          best = {
            t,
            x: px + dx * t,
            y: py + dy * t,
            tx: ex / len,
            ty: ey / len,
            nx,
            ny,
            edgeIndex: i,
            isWall: isWallEdge(i),
          };
        }
      }
    }
    return best;
  }

  function getArenaSpawnRadius() {
    return R * 0.635;
  }

  function safeStorageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function safeStorageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {
      /* storage can be unavailable in private contexts */
    }
  }

  const COIN_DEFS = [
    {
      id: 'gold',
      name: '金乌',
      glyph: '●',
      role: '均衡',
      roleEn: 'BALANCED',
      tag: 'YOUR COIN',
      color: '#ffd166',
      rgb: '255,209,102',
      faceLight: '#fff4c8',
      faceMid: '#d8a53c',
      faceDark: '#57370b',
      emblem: 'sun',
      mass: 1.0,
      radius: 29,
      launchMin: 300,
      launchMax: 1490,
      aiSkill: 0.04,
      skill: {
        name: '熔芯',
        tag: '蓄力强化',
        short: '蓄力 ≥75% 初速 +8%',
        desc: '蓄力达到 75% 或更高时，发射初速提高 8%。',
        tip: '把力度压在高温区，用一记更远的直线穿过桌面。',
      },
    },
    {
      id: 'red',
      name: '赤狐',
      glyph: '◆',
      role: '重击手',
      roleEn: 'IMPACT',
      tag: 'HEAVY',
      color: '#ff6576',
      rgb: '255,101,118',
      faceLight: '#ffd7dc',
      faceMid: '#cf5362',
      faceDark: '#4a0b14',
      emblem: 'star',
      mass: 1.32,
      radius: 31,
      launchMin: 280,
      launchMax: 1380,
      aiSkill: 0.052,
      aggression: 0.72,
      impactBonus: 0.2,
      skill: {
        name: '破阵',
        tag: '进攻',
        short: '撞击对手时冲量 +20%',
        desc: '撞向对手时，把额外 20% 的冲击力灌向对手；被别人撞时不会触发。',
        tip: '正面撞人，把对手直接推向最近的开放边。',
      },
    },
    {
      id: 'cyan',
      name: '青雀',
      glyph: '≈',
      role: '轻量级',
      roleEn: 'LIGHT',
      tag: 'LIGHT',
      color: '#58e4d2',
      rgb: '88,228,210',
      faceLight: '#d3fff9',
      faceMid: '#3bb9ae',
      faceDark: '#06393a',
      emblem: 'wave',
      mass: 0.8,
      radius: 27,
      launchMin: 320,
      launchMax: 1580,
      aiSkill: 0.045,
      aggression: 0.48,
      frictionScale: 0.8,
      skill: {
        name: '掠影',
        tag: '机动',
        short: '滑行阻力 -20%',
        desc: '滑行阻力降低 20%，同等力度下滚得更远。',
        tip: '轻力度也能绕场半圈，适合从意想不到的角度切进战场。',
      },
    },
    {
      id: 'violet',
      name: '紫电',
      glyph: 'ϟ',
      role: '变速型',
      roleEn: 'CHAOS',
      tag: 'CHAOS',
      color: '#b99aff',
      rgb: '185,154,255',
      faceLight: '#f0e7ff',
      faceMid: '#8963cf',
      faceDark: '#29134b',
      emblem: 'bolt',
      mass: 0.94,
      radius: 29,
      launchMin: 290,
      launchMax: 1520,
      aiSkill: 0.062,
      aggression: 0.6,
      skill: {
        name: '余弧',
        tag: '连击',
        short: '每杆首次碰撞后速度 +7%',
        desc: '每一杆第一次撞到硬币后，自身速度提高 7%。',
        tip: '让第一下碰撞成为连锁的起点，撞得越多越危险。',
      },
    },
    {
      id: 'rose',
      name: '玫爵',
      glyph: '✿',
      role: '反弹型',
      roleEn: 'REFLECT',
      tag: 'REFLECT',
      color: '#ff86ad',
      rgb: '255,134,173',
      faceLight: '#ffe2ec',
      faceMid: '#d55d87',
      faceDark: '#4d1024',
      emblem: 'bloom',
      mass: 0.88,
      radius: 28,
      launchMin: 300,
      launchMax: 1520,
      aiSkill: 0.048,
      aggression: 0.52,
      wallRestitution: 0.84,
      wallTangent: 0.96,
      skill: {
        name: '镜壁',
        tag: '墙壁',
        short: '撞墙保留 84% 法向速度',
        desc: '撞墙时保留 84% 的法向速度（通常为 56%），并保留更多切向速度。',
        tip: '在有墙的地图里，借墙反弹可以打出意想不到的第二段角度。',
      },
    },
    {
      id: 'moss',
      name: '苍苔',
      glyph: '❖',
      role: '防守型',
      roleEn: 'GUARD',
      tag: 'GUARD',
      color: '#8fd694',
      rgb: '143,214,148',
      faceLight: '#e6ffe6',
      faceMid: '#62a96a',
      faceDark: '#12371a',
      emblem: 'leaf',
      mass: 1.15,
      radius: 30,
      launchMin: 280,
      launchMax: 1400,
      aiSkill: 0.045,
      aggression: 0.4,
      incomingResist: 0.78,
      skill: {
        name: '苔甲',
        tag: '防守',
        short: '受到冲量 -22%',
        desc: '被其他硬币撞击时，受到的冲量减少 22%。',
        tip: '站住中心，让对手来撞你；越被动，越能反客为主。',
      },
    },
    {
      id: 'azure',
      name: '靛蓝',
      glyph: '◎',
      role: '精准型',
      roleEn: 'PRECISION',
      tag: 'PRECISION',
      color: '#6fa8ff',
      rgb: '111,168,255',
      faceLight: '#dceaff',
      faceMid: '#4b7fc9',
      faceDark: '#0b2247',
      emblem: 'target',
      mass: 0.92,
      radius: 29,
      launchMin: 305,
      launchMax: 1510,
      aiSkill: 0.038,
      aggression: 0.5,
      skill: {
        name: '定轨',
        tag: '节奏',
        short: '50%–78% 力度初速 +10%',
        desc: '力度处于 50%–78% 时，发射初速提高 10%。',
        tip: '不必满力。稳定落在甜区，才是它的节奏。',
      },
    },
    {
      id: 'amber',
      name: '琥珀',
      glyph: '✦',
      role: '爆发型',
      roleEn: 'BURST',
      tag: 'BURST',
      color: '#ffa45c',
      rgb: '255,164,92',
      faceLight: '#ffe4c9',
      faceMid: '#d87a36',
      faceDark: '#4b1e06',
      emblem: 'flame',
      mass: 1.05,
      radius: 29,
      launchMin: 295,
      launchMax: 1560,
      aiSkill: 0.055,
      aggression: 0.68,
      skill: {
        name: '孤注',
        tag: '爆发',
        short: '≥90% 力度初速 +16% / 摩擦 +14%',
        desc: '力度达到 90% 时，发射初速提高 16%，但这一杆的滑行阻力增加 14%。',
        tip: '一击定胜负。打空，就会把位置和节奏一起交出去。',
      },
    },
    {
      id: 'echo',
      name: '回声',
      glyph: '↩',
      role: '折返型',
      roleEn: 'RECALL',
      tag: 'RECALL',
      color: '#dbe7ff',
      rgb: '219,231,255',
      faceLight: '#ffffff',
      faceMid: '#a8bdd8',
      faceDark: '#1c3048',
      emblem: 'echo',
      mass: 0.92,
      radius: 29,
      launchMin: 300,
      launchMax: 1510,
      aiSkill: 0.05,
      aggression: 0.5,
      skill: {
        name: '折返',
        tag: '标记',
        short: 'E 留标 / 敌人回合再按 E 折返',
        desc: '自己的回合按 E 在原地留下标记，标记会一直保留；之后在敌人回合的任意时刻再按 E，回到标记点并保留按下瞬间的速度与旋转。两段都使用完后进入 3 个自己的回合冷却。',
        tip: '先留好退路，等追兵逼近时再折返。标记可以跨回合保留，但第二段用掉之前不能再留新标。',
      },
    },
    {
      id: 'curve',
      name: '流萤',
      glyph: '↝',
      role: '操舵型',
      roleEn: 'STEERING',
      tag: 'CURVE',
      color: '#a6ff5e',
      rgb: '166,255,94',
      faceLight: '#f4ffdc',
      faceMid: '#c8f28a',
      faceDark: '#1d3310',
      emblem: 'curve',
      mass: 0.9,
      radius: 29,
      launchMin: 290,
      launchMax: 1490,
      aiSkill: 0.05,
      aggression: 0.52,
      skill: {
        name: '偏流',
        tag: '主动 · 能量',
        short: '滑行中按住 Q 左偏 / E 右偏 · 每秒耗能 5',
        desc: '拥有 100 点能量。硬币滑行时按住 Q 向左偏转、按住 E 向右偏转；按住时间越长，转向幅度越大。偏转每秒消耗 5 点能量，能量耗尽后无法继续转向。',
        tip: '先直射，等硬币接近对手或边界时再按住 Q / E 把路线弯过去。100 点能量只够持续偏转 20 秒。',
      },
    },
    {
      id: 'anchor',
      name: '锚星',
      glyph: '⌖',
      role: '截击型',
      roleEn: 'INTERCEPTOR',
      tag: 'ANCHOR',
      color: '#9bd7ff',
      rgb: '155,215,255',
      faceLight: '#f1fbff',
      faceMid: '#bfe9ff',
      faceDark: '#102b3a',
      emblem: 'anchor',
      mass: 1.05,
      radius: 30,
      launchMin: 300,
      launchMax: 1500,
      aiSkill: 0.05,
      aggression: 0.58,
      skill: {
        name: '急停',
        tag: '主动 · 冷却',
        short: '滑行中按 E 立刻停住，随后二次瞄准发射 · 冷却 4 回合',
        desc: '硬币滑行过程中按 E，会立刻停在按下瞬间的位置，并进入一次额外的瞄准与发射。二次发射结束后本回合结束，技能进入 4 个回合的冷却。',
        tip: '可以先把硬币送到有利位置，再急停重新瞄准；注意急停后硬币会停在原地，仍可能被其他硬币撞击。',
      },
    },
  ];

  const DEF_BY_ID = Object.fromEntries(COIN_DEFS.map((d) => [d.id, d]));
  const storedPlayer = safeStorageGet('edgecoin.player');
  const INITIAL_PLAYER_ID = DEF_BY_ID[storedPlayer] ? storedPlayer : 'gold';
  const storedMatchSizeRaw = safeStorageGet('edgecoin.matchSize');
  const storedMatchSize = storedMatchSizeRaw === null ? NaN : Number(storedMatchSizeRaw);
  const INITIAL_MATCH_SIZE = Number.isFinite(storedMatchSize)
    ? Math.min(24, Math.max(2, Math.round(storedMatchSize)))
    : 4;
  const INITIAL_ROSTER_HIDDEN = safeStorageGet('edgecoin.rosterHidden') === '1';
  const CURVE_MAX_ENERGY = 100;
  const CURVE_ENERGY_DRAIN = 5;
  const CURVE_TURN_MIN = 1.15;
  const CURVE_TURN_MAX = 3.45;
  const CURVE_HOLD_RAMP = 1.15;
  const PLAYER_TIPS = Object.fromEntries(COIN_DEFS.map((d) => [d.id, d.skill.tip]));

  const GAME_MODES = {
    turn: {
      id: 'turn',
      label: '轮流',
      note: '轮流出手 · 首发保护 · 顺序随机',
    },
    volley: {
      id: 'volley',
      label: '齐射',
      note: '齐射 · 所有硬币锁定后同时发射',
    },
    chase: {
      id: 'chase',
      label: '追击',
      note: '本地弹射迷宫逃脱 · 1–7 名追兵 · 找到出口',
    },
  };
  const storedMode = safeStorageGet('edgecoin.mode');
  const INITIAL_MODE = GAME_MODES[storedMode] ? storedMode : 'turn';
  const CHASE_GRID = 25;
  const CHASE_CELL = 160;
  const CHASE_RADIUS = 2000;
  const CHASE_WALL = 16;
  const CHASE_PLAYER_R = 26;
  const CHASE_WALL_BOUNCE = 0.62;
  const AI_PERSONALITIES = [
    { id: 'greedy', name: '贪心', color: '#ffd166', desc: '总挑最近的目标，追求立刻撞到。' },
    { id: 'steady', name: '稳妥', color: '#6fa8ff', desc: '存活数 ≥ 一半时去中央，否则打人。' },
    { id: 'rage', name: '暴怒', color: '#ff6576', desc: '优先撞最近的对手，力度更猛。' },
    { id: 'lazy', name: '懒惰', color: '#8fd694', desc: '出手慢、力度轻，经常敷衍了事。' },
    { id: 'random', name: '随机', color: '#b99aff', desc: '目标和力度都随机。' },
    { id: 'smart', name: '聪明', color: '#58e4d2', desc: '预判走位，偏向边界与玩家。' },
    { id: 'blackdog', name: '黑狗', color: '#ffb347', desc: '全能战术 AI，按硬币技能制定打法。' },
    { id: 'meow', name: '喵喵', color: '#ff86ad', desc: '随性扑击，偶尔喵一声。' },
  ];
  const storedPersonalityPoolRaw = safeStorageGet('edgecoin.personalityPool');
  let storedPersonalityPool = null;
  try {
    storedPersonalityPool = JSON.parse(storedPersonalityPoolRaw || 'null');
  } catch (error) {
    storedPersonalityPool = null;
  }
  const INITIAL_PERSONALITY_POOL = Array.isArray(storedPersonalityPool)
    ? AI_PERSONALITIES
      .map((personality) => personality.id)
      .filter((id) => storedPersonalityPool.includes(id))
    : AI_PERSONALITIES.map((personality) => personality.id);
  if (!INITIAL_PERSONALITY_POOL.length) {
    INITIAL_PERSONALITY_POOL.push(...AI_PERSONALITIES.map((personality) => personality.id));
  }
  const CHASE_ROLES = [
    { id: 'hunter', name: '猎手', target: 'player', speed: 1.08 },
    { id: 'flanker', name: '侧翼', target: 'flank', speed: 1.0 },
    { id: 'ambusher', name: '伏击', target: 'lead', speed: 0.94 },
    { id: 'blocker', name: '截断', target: 'block', speed: 0.9 },
    { id: 'prowler', name: '游猎', target: 'near', speed: 0.97 },
  ];
  const CHASE_KEY_MAP = {
    w: 'up',
    a: 'left',
    s: 'down',
    d: 'right',
    ArrowUp: 'up',
    ArrowLeft: 'left',
    ArrowDown: 'down',
    ArrowRight: 'right',
  };
  const storedChaseHpRaw = safeStorageGet('edgecoin.chaseHp');
  const storedChaseHp = storedChaseHpRaw === null ? NaN : Number(storedChaseHpRaw);
  const INITIAL_CHASE_HP = Number.isFinite(storedChaseHp)
    ? Math.min(5, Math.max(1, Math.round(storedChaseHp)))
    : 3;


  /* =========================================================
     Audio
     ========================================================= */
  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.comp = null;
      this.noise = null;
      this.muted = safeStorageGet('edgecoin.muted') === '1';
      this.chargeOsc = null;
      this.chargeGain = null;
      this.chargeFilter = null;
      this.lastImpact = 0;
      this.lastWall = 0;
    }

    init() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
        return;
      }
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      try {
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.58;
        this.comp = this.ctx.createDynamicsCompressor();
        this.comp.threshold.value = -18;
        this.comp.knee.value = 16;
        this.comp.ratio.value = 5;
        this.comp.attack.value = 0.003;
        this.comp.release.value = 0.22;
        this.master.connect(this.comp).connect(this.ctx.destination);
        this.noise = this.makeNoise(1.2);
      } catch (e) {
        this.ctx = null;
      }
    }

    makeNoise(seconds) {
      const rate = this.ctx.sampleRate;
      const buffer = this.ctx.createBuffer(1, Math.floor(rate * seconds), rate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) {
        data[i] = Math.random() * 2 - 1;
      }
      return buffer;
    }

    setMuted(muted) {
      this.muted = muted;
      safeStorageSet('edgecoin.muted', muted ? '1' : '0');
      if (this.ctx && this.master) {
        this.master.gain.cancelScheduledValues(this.ctx.currentTime);
        this.master.gain.setTargetAtTime(muted ? 0 : 0.58, this.ctx.currentTime, 0.025);
      }
    }

    toggleMuted() {
      this.setMuted(!this.muted);
      return this.muted;
    }

    noiseBurst(duration, frequency, q, gain, type = 'bandpass', when = 0) {
      if (!this.ctx || !this.noise || this.muted) return;
      const t = this.ctx.currentTime + when;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      const filter = this.ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.setValueAtTime(frequency, t);
      filter.Q.value = q;
      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.006);
      env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      src.connect(filter).connect(env).connect(this.master);
      src.start(t, Math.random() * 0.7, duration + 0.02);
      src.stop(t + duration + 0.03);
    }

    ping(freq, duration, gain, type = 'sine', when = 0, bend = 1) {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime + when;
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (bend !== 1) osc.frequency.exponentialRampToValueAtTime(freq * bend, t + duration);
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.007);
      env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.connect(env).connect(this.master);
      osc.start(t);
      osc.stop(t + duration + 0.02);
    }

    ui() {
      this.init();
      this.ping(780, 0.055, 0.035, 'sine');
      this.noiseBurst(0.04, 2600, 2.5, 0.018, 'highpass');
    }

    meow() {
      this.init();
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime;
      const base = 560 + Math.random() * 150;
      const osc = this.ctx.createOscillator();
      const formant = this.ctx.createBiquadFilter();
      const env = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(base, t);
      osc.frequency.exponentialRampToValueAtTime(base * 1.55, t + 0.075);
      osc.frequency.exponentialRampToValueAtTime(base * 0.92, t + 0.19);
      osc.frequency.exponentialRampToValueAtTime(base * 0.6, t + 0.34);
      formant.type = 'bandpass';
      formant.frequency.setValueAtTime(1050, t);
      formant.frequency.exponentialRampToValueAtTime(1720, t + 0.12);
      formant.frequency.exponentialRampToValueAtTime(780, t + 0.34);
      formant.Q.value = 2.1;
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.055, t + 0.018);
      env.gain.exponentialRampToValueAtTime(0.022, t + 0.2);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.37);
      osc.connect(formant).connect(env).connect(this.master);
      osc.start(t);
      osc.stop(t + 0.39);
      this.noiseBurst(0.16, 1500, 1.6, 0.012, 'bandpass', 0.015);
      this.ping(base * 2.1, 0.1, 0.012, 'sine', 0.01, 0.72);
    }

    launch(power) {
      this.init();
      const p = clamp(power, 0, 1);
      this.noiseBurst(0.2 + p * 0.13, 900 + p * 1600, 0.8, 0.07 + p * 0.04, 'bandpass');
      this.ping(180 + p * 90, 0.18 + p * 0.08, 0.055, 'triangle', 0, 0.58);
      this.ping(1020 + p * 320, 0.09, 0.018, 'sine', 0.02, 0.7);
    }

    impact(closingSpeed) {
      if (!this.ctx || this.muted) return;
      const now = this.ctx.currentTime;
      if (now - this.lastImpact < 0.038) return;
      this.lastImpact = now;
      const power = clamp(closingSpeed / 1400, 0.12, 1);
      const base = 950 + power * 620 + rand(-40, 40);
      this.noiseBurst(0.065 + power * 0.065, 2200 + power * 1700, 1.15, 0.05 + power * 0.075, 'bandpass');
      this.ping(base, 0.1 + power * 0.1, 0.035 + power * 0.045, 'sine', 0, 0.82);
      this.ping(base * 1.47, 0.075 + power * 0.06, 0.018 + power * 0.025, 'triangle', 0.006, 0.88);
      this.ping(120 + power * 45, 0.08 + power * 0.05, 0.03 + power * 0.035, 'sine', 0, 0.64);
    }

    wallBounce(power) {
      if (!this.ctx || this.muted) return;
      const now = this.ctx.currentTime;
      if (now - this.lastWall < 0.05) return;
      this.lastWall = now;
      const p = clamp(power, 0, 1);
      this.noiseBurst(0.08 + p * 0.08, 520 + p * 540, 0.8, 0.045 + p * 0.055, 'bandpass');
      this.ping(150 + p * 55, 0.17 + p * 0.1, 0.045 + p * 0.025, 'triangle', 0, 0.7);
      this.ping(620 + p * 260, 0.1 + p * 0.07, 0.017 + p * 0.018, 'sine', 0.01, 0.82);
    }

    shrink() {
      if (!this.ctx || this.muted) return;
      this.noiseBurst(0.55, 190, 0.65, 0.07, 'lowpass');
      this.ping(58, 0.62, 0.12, 'sine', 0, 0.6);
      this.ping(112, 0.34, 0.05, 'triangle', 0.02, 0.42);
      this.ping(340, 0.2, 0.022, 'sine', 0.04, 0.75);
    }

    volley(power, count) {
      if (!this.ctx || this.muted) return;
      const p = clamp(power, 0, 1);
      const weight = clamp(count / 8, 0.2, 1);
      this.noiseBurst(0.3 + p * 0.16, 420 + p * 900, 0.85, 0.06 + weight * 0.04, 'bandpass');
      this.ping(74 + p * 28, 0.38, 0.06 + weight * 0.05, 'sine', 0, 0.62);
      this.ping(220 + p * 160, 0.22, 0.035 + weight * 0.03, 'triangle', 0.01, 0.78);
      this.ping(980 + p * 320, 0.1, 0.018 + weight * 0.012, 'sine', 0.02, 0.9);
    }

    echoMark() {
      this.ping(620, 0.14, 0.026, 'sine', 0, 0.7);
      this.ping(930, 0.18, 0.018, 'triangle', 0.01, 0.8);
    }

    echoRecall() {
      this.ping(1080, 0.2, 0.032, 'triangle', 0, 0.7);
      this.ping(470, 0.28, 0.03, 'sine', 0.02, 0.65);
      this.noiseBurst(0.22, 1500, 0.6, 0.035, 'highpass');
    }

    startCharge() {      this.init();
      if (!this.ctx || this.muted) return;
      this.stopCharge();
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(58, t);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(420, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.012, t + 0.12);
      osc.connect(filter).connect(gain).connect(this.master);
      osc.start(t);
      this.chargeOsc = osc;
      this.chargeGain = gain;
      this.chargeFilter = filter;
    }

    updateCharge(power) {
      if (!this.ctx || !this.chargeOsc) return;
      const t = this.ctx.currentTime;
      this.chargeOsc.frequency.setTargetAtTime(58 + power * 110, t, 0.03);
      this.chargeFilter.frequency.setTargetAtTime(380 + power * 820, t, 0.04);
      this.chargeGain.gain.setTargetAtTime(0.011 + power * 0.018, t, 0.04);
    }

    stopCharge() {
      if (!this.ctx || !this.chargeOsc) return;
      const t = this.ctx.currentTime;
      try {
        this.chargeGain.gain.cancelScheduledValues(t);
        this.chargeGain.gain.setTargetAtTime(0.0001, t, 0.018);
        this.chargeOsc.stop(t + 0.08);
      } catch (e) {
        /* oscillator may already be stopped */
      }
      this.chargeOsc = null;
      this.chargeGain = null;
      this.chargeFilter = null;
    }

    eliminate() {
      this.init();
      this.noiseBurst(0.42, 420, 0.7, 0.1, 'lowpass');
      this.ping(300, 0.58, 0.09, 'sawtooth', 0, 0.18);
      this.ping(90, 0.42, 0.08, 'sine', 0.03, 0.5);
      this.ping(1500, 0.2, 0.03, 'sine', 0.07, 0.45);
    }

    win() {
      this.init();
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => {
        this.ping(f, 0.42, 0.055, 'triangle', i * 0.1, 0.995);
        this.ping(f * 2, 0.22, 0.012, 'sine', i * 0.1, 1);
      });
      this.noiseBurst(0.8, 2200, 0.6, 0.03, 'highpass', 0.1);
    }

    lose() {
      this.init();
      this.ping(220, 0.8, 0.07, 'sawtooth', 0, 0.42);
      this.ping(110, 0.9, 0.055, 'sine', 0.06, 0.45);
      this.noiseBurst(0.5, 250, 0.5, 0.03, 'lowpass', 0.05);
    }

    turn() {
      this.ping(660, 0.08, 0.02, 'sine');
      this.ping(990, 0.11, 0.014, 'sine', 0.035);
    }
  }

  /* =========================================================
     DOM
     ========================================================= */
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const dom = {
    stage: $('#stage'),
    canvas: $('#game-canvas'),
    hud: $('#hud'),
    menu: $('#menuScreen'),
    help: $('#helpScreen'),
    arena: $('#arenaScreen'),
    result: $('#gameoverScreen'),
    startBanner: $('#startBanner'),
    roundFlash: $('#roundFlash'),
    rosterList: $('#rosterList'),
    rosterCount: $('#rosterCount'),
    rosterInspectBtn: $('#rosterInspectBtn'),
    roster: $('.roster'),
    rosterHideBtn: $('#rosterHideBtn'),
    rosterShowBtn: $('#rosterShowBtn'),
    rosterShowCount: $('#rosterShowCount'),
    liveLabel: $('#liveLabel'),
    arenaLabel: $('#arenaLabel'),
    aliveLabel: $('#aliveLabel'),
    hitCounter: $('#hitCounter'),
    speedCounter: $('#speedCounter'),
    timeCounter: $('#timeCounter'),
    difficultyCounter: $('#difficultyCounter'),
    difficultyLabel: $('#difficultyLabel'),
    zoomValue: $('#zoomValue'),
    turnDock: $('#turnDock'),
    turnKicker: $('#turnKicker'),
    turnTitle: $('#turnTitle'),
    turnHint: $('#turnHint'),
    powerFill: $('#powerFill'),
    powerTrack: $('#powerTrack'),
    powerValue: $('#powerValue'),
    powerLabel: $('#powerLabel'),
    shotClock: $('#shotClock'),
    shotClockValue: $('#shotClockValue'),
    shotClockBig: $('#shotClockBig'),
    shotClockBigLabel: $('#shotClockBigLabel'),
    shotClockBigValue: $('#shotClockBigValue'),
    shotClockBigFill: $('#shotClockBigFill'),
    skillBadge: $('#skillBadge'),
    skillBadgeIcon: $('#skillBadgeIcon'),
    skillBadgeKicker: $('#skillBadgeKicker'),
    skillBadgeName: $('#skillBadgeName'),
    skillBadgeHint: $('#skillBadgeHint'),
    skillBadgeKey: $('#skillBadgeKey'),
    curveEnergy: $('#curveEnergy'),
    curveEnergyFill: $('#curveEnergyFill'),
    curveEnergyValue: $('#curveEnergyValue'),
    toastLayer: $('#toastLayer'),
    comboBadge: $('#comboBadge'),
    soundToggle: $('#soundToggle'),
    fullscreenToggle: $('#fullscreenToggle'),
    restartBtn: $('#restartBtn'),
    onlineExitBtn: $('#onlineExitBtn'),
    quitGameBtn: $('#quitGameBtn'),
    quit: $('#quitScreen'),
    quitCancel: $('#quitCancel'),
    quitConfirm: $('#quitConfirm'),
    quitDesc: $('#quitDesc'),
    aiPersonaBtn: $('#aiPersonaBtn'),
    aiPersona: $('#aiPersonaScreen'),
    aiPersonaList: $('#aiPersonaList'),
    aiPersonaClose: $('#aiPersonaClose'),
    aiPersonaDone: $('#aiPersonaDone'),
    helpBtn: $('#helpBtn'),
    zoomOut: $('#zoomOut'),
    zoomIn: $('#zoomIn'),
    startBtn: $('#startBtn'),
    menuHelpBtn: $('#menuHelpBtn'),
    onlineBtn: $('#onlineBtn'),
    online: $('#onlineScreen'),
    onlineClose: $('#onlineClose'),
    onlineEntry: $('#onlineEntry'),
    onlineName: $('#onlineName'),
    onlineCoinOrb: $('#onlineCoinOrb'),
    onlineCoinName: $('#onlineCoinName'),
    onlineCode: $('#onlineCode'),
    onlineCreate: $('#onlineCreate'),
    onlineJoin: $('#onlineJoin'),
    onlineError: $('#onlineError'),
    onlineRoom: $('#onlineRoom'),
    onlineRoomCode: $('#onlineRoomCode'),
    onlineCopy: $('#onlineCopy'),
    onlineShare: $('#onlineShare'),
    onlineModeButtons: $$('#onlineModeSwitch button[data-mode]'),
    onlineModeNote: $('#onlineModeNote'),
    onlineArenaSummary: $('#onlineArenaSummary'),
    onlineArenaBtn: $('#onlineArenaBtn'),
    onlinePoolSummary: $('#onlinePoolSummary'),
    onlinePoolBtn: $('#onlinePoolBtn'),
    onlineScreen: $('#onlineScreen'),
    onlineSlots: $('#onlineSlots'),
    onlineCoinPicker: $('#onlineCoinPicker'),
    onlineCoinPickerTitle: $('#onlineCoinPickerTitle'),
    onlineCoinOptions: $('#onlineCoinOptions'),
    onlineCoinPickerClose: $('#onlineCoinPickerClose'),
    onlineCoinPickerHint: $('#onlineCoinPickerHint'),
    onlineSlotCount: $('#onlineSlotCount'),
    onlineFillAI: $('#onlineFillAI'),
    onlineHostSlot: $('#onlineHostSlot'),
    onlineHostOrb: $('#onlineHostOrb'),
    onlineHostName: $('#onlineHostName'),
    onlineHostCoin: $('#onlineHostCoin'),
    onlineGuestSlot: $('#onlineGuestSlot'),
    onlineGuestOrb: $('#onlineGuestOrb'),
    onlineGuestName: $('#onlineGuestName'),
    onlineGuestCoin: $('#onlineGuestCoin'),
    onlineRoomHint: $('#onlineRoomHint'),
    onlineRoomError: $('#onlineRoomError'),
    onlineStart: $('#onlineStart'),
    onlineLeave: $('#onlineLeave'),
    arenaBtn: $('#arenaBtn'),
    arenaBtnLabel: $('#arenaBtnLabel'),
    arenaClose: $('#arenaClose'),
    arenaDone: $('#arenaDone'),
    arenaReset: $('#arenaReset'),
    arenaShapeButtons: $$('.shape-option[data-shape]'),
    arenaSizeRange: $('#arenaSizeRange'),
    arenaSizeValue: $('#arenaSizeValue'),
    arenaSummary: $('#arenaSummary'),
    arenaDescription: $('#arenaDescription'),
    arenaEdgeType: $('#arenaEdgeType'),
    arenaSpace: $('#arenaSpace'),
    wallSection: $('#wallSection'),
    wallHint: $('#wallHint'),
    wallGrid: $('#wallGrid'),
    obstacleSection: $('#obstacleSection'),
    obstacleEnabled: $('#obstacleEnabled'),
    obstacleCustomPlacement: $('#obstacleCustomPlacement'),
    obstacleCustomPanel: $('#obstacleCustomPanel'),
    obstacleSizeRange: $('#obstacleSizeRange'),
    obstacleSizeValue: $('#obstacleSizeValue'),
    obstacleRotationRange: $('#obstacleRotationRange'),
    obstacleRotationValue: $('#obstacleRotationValue'),
    obstacleCustomHint: $('#obstacleCustomHint'),
    obstacleCountRange: $('#obstacleCountRange'),
    obstacleCountValue: $('#obstacleCountValue'),
    obstacleTypeButtons: $$('.obstacle-type-btn[data-obstacle-type]'),
    obstacleShapeButtons: $$('.obstacle-shape-btn[data-obstacle-shape]'),
    obstacleHint: $('#obstacleHint'),
    shrinkPanel: $('#shrinkPanel'),
    turnLimitRange: $('#turnLimitRange'),
    shrinkRateRange: $('#shrinkRateRange'),
    turnLimitValue: $('#turnLimitValue'),
    shrinkRateValue: $('#shrinkRateValue'),
    shrinkHint: $('#shrinkHint'),
    shrinkRateControl: $('#shrinkRateControl'),
    arenaPreview: $('#arenaPreview'),
    menuTip: $('#menuTip'),
    menuTipText: $('#menuTipText'),
    selectedCoinBtn: $('#selectedCoinBtn'),
    selectedOrb: $('#selectedOrb'),
    selectedGlyph: $('#selectedGlyph'),
    selectedCoinName: $('#selectedCoinName'),
    selectedCoinRole: $('#selectedCoinRole'),
    selectedSkillName: $('#selectedSkillName'),
    selectedSkillShort: $('#selectedSkillShort'),
    matchSizeButtons: $$('#matchSizeSwitch button[data-size]'),
    matchSizeCapLabel: $('#matchSizeCapLabel'),
    matchSizeRangeBlock: $('#matchSizeRangeBlock'),
    matchSizeRange: $('#matchSizeRange'),
    matchSizeRangeValue: $('#matchSizeRangeValue'),
    matchSizeNote: $('#matchSizeNote'),
    modeButtons: $$('#modeSwitch button[data-mode]'),
    modeNote: $('#modeNote'),
    chaseHpBlock: $('#chaseHpBlock'),
    chaseHpButtons: $$('#chaseHpSwitch button[data-hp]'),
    chaseStatus: $('#chaseStatus'),
    chaseHearts: $('#chaseHearts'),
    chaseExit: $('#chaseExit'),
    chaseMove: $('#chaseMove'),
    chaseMoveLabel: $('#chaseMoveLabel'),
    chasePowerFill: $('#chasePowerFill'),
    chasePowerText: $('#chasePowerText'),
    chaseEnemyNote: $('#chaseEnemyNote'),
    resultStatLabels: $$('.result-stats div span'),
    ruleRows: $$('.rule-stack .rule-row p'),
    codex: $('#codexScreen'),
    codexClose: $('#codexClose'),
    codexDone: $('#codexDone'),
    codexList: $('#codexList'),
    codexOrb: $('#codexOrb'),
    codexGlyph: $('#codexGlyph'),
    codexRole: $('#codexRole'),
    codexName: $('#codexName'),
    codexTagline: $('#codexTagline'),
    codexSkillName: $('#codexSkillName'),
    codexSkillTag: $('#codexSkillTag'),
    codexSkillDesc: $('#codexSkillDesc'),
    codexMass: $('#codexMass'),
    codexSpeed: $('#codexSpeed'),
    codexRoleShort: $('#codexRoleShort'),
    codexTip: $('#codexTip'),
    codexSelectBtn: $('#codexSelectBtn'),
    inspect: $('#inspectScreen'),
    inspectClose: $('#inspectClose'),
    inspectResume: $('#inspectResume'),
    inspectList: $('#inspectList'),
    inspectOrb: $('#inspectOrb'),
    inspectGlyph: $('#inspectGlyph'),
    inspectRole: $('#inspectRole'),
    inspectName: $('#inspectName'),
    inspectTagline: $('#inspectTagline'),
    inspectSkillName: $('#inspectSkillName'),
    inspectSkillTag: $('#inspectSkillTag'),
    inspectSkillDesc: $('#inspectSkillDesc'),
    inspectMass: $('#inspectMass'),
    inspectSpeed: $('#inspectSpeed'),
    inspectOrder: $('#inspectOrder'),
    inspectOrderLabel: $('#inspectOrderLabel'),
    inspectStatus: $('#inspectStatus'),
    inspectTip: $('#inspectTip'),
    difficultyButtons: $$('.difficulty-btn[data-difficulty]'),
    difficultyNote: $('#difficultyNote'),
    personalityPoolBtn: $('#personalityPoolBtn'),
    personalityPoolSummary: $('#personalityPoolSummary'),
    personalityPoolNote: $('#personalityPoolNote'),
    personalityPool: $('#personalityPoolScreen'),
    personalityPoolList: $('#personalityPoolList'),
    personalityPoolClose: $('#personalityPoolClose'),
    personalityPoolAll: $('#personalityPoolAll'),
    personalityPoolDefault: $('#personalityPoolDefault'),
    personalityPoolDone: $('#personalityPoolDone'),
    helpClose: $('#helpClose'),
    helpCloseBtn: $('#helpCloseBtn'),
    helpStartBtn: $('#helpStartBtn'),
    playAgainBtn: $('#playAgainBtn'),
    returnRoomBtn: $('#returnRoomBtn'),
    backToMenuBtn: $('#backToMenuBtn'),
    resultKicker: $('#resultKicker'),
    resultTime: $('#resultTime'),
    resultEyebrow: $('#resultEyebrow'),
    resultTitle: $('#resultTitle'),
    resultSub: $('#resultSub'),
    statKOs: $('#statKOs'),
    statHits: $('#statHits'),
    statSpeed: $('#statSpeed'),
    statTime: $('#statTime'),
  };

  const ctx = dom.canvas.getContext('2d', { alpha: true });
  const previewCtx = dom.arenaPreview.getContext('2d');
  const audio = new AudioEngine();
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* =========================================================
     Game state
     ========================================================= */
  const G = {
    phase: 'menu',
    paused: false,
    helpOpen: false,
    quitOpen: false,
    aiPersonaOpen: false,
    arenaOpen: false,
    resultOpen: false,
    onlineLobbyOpen: false,
    onlineArenaEditing: false,
    online: null,
    time: 0,
    menuTime: 0,
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: 1,
    baseZoom: 0.75,
    zoomAdjusted: false,
    camera: {
      x: 0,
      y: 0,
      tx: 0,
      ty: 0,
      homeX: 0,
      homeY: 0,
      zoom: 0.75,
      tzoom: 0.75,
      shake: 0,
      shakeX: 0,
      shakeY: 0,
      userPanned: false,
    },
    panKeys: {
      up: false,
      down: false,
      left: false,
      right: false,
    },
    panHintShown: false,
    pointer: {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      worldX: 0,
      worldY: 0,
      inside: false,
      down: false,
    },
    aim: {
      angle: -Math.PI / 2,
      power: 0,
      chargeT: 0,
      charging: false,
    },
    anchorBonus: null,
    anchorSerial: 0,
    curveInput: {
      left: false,
      right: false,
    },
    playerId: INITIAL_PLAYER_ID,
    matchSize: INITIAL_MATCH_SIZE,
    personalityPool: INITIAL_PERSONALITY_POOL.slice(),
    personalityPoolOpen: false,
    rosterHidden: INITIAL_ROSTER_HIDDEN,
    mode: INITIAL_MODE,
    chaseHp: INITIAL_CHASE_HP,
    chase: null,
    participants: [],
    difficulty: INITIAL_DIFFICULTY,
    codexOpen: false,
    codexPreviewId: INITIAL_PLAYER_ID,
    inspectOpen: false,
    inspectCoinId: null,
    volley: null,
    arena: { ...INITIAL_ARENA, walls: sanitizeWalls(INITIAL_ARENA.walls), shrink: 1 },
    obstacles: [],
    arenaObstaclePreview: null,
    arenaObstacleSelected: 0,
    obstacleLastCount: 4,
    shrinkFlash: 0,
    coins: [],
    active: null,
    activeIndex: -1,
    turn: 0,
    alive: 4,
    introT: 0,
    resolve: {
      elapsed: 0,
      still: 0,
      delay: 0,
    },
    ai: {
      plan: null,
      elapsed: 0,
      waiting: 0,
      planned: false,
    },
    stats: {
      hits: 0,
      kos: 0,
      topSpeed: 0,
      shots: 0,
      elapsed: 0,
      matchTime: 0,
    },
    slowmo: 0,
    timeScale: 1,
    pending: null,
    playerOut: false,
    winnerId: null,
    combo: {
      count: 0,
      timer: 0,
      last: -10,
    },
    dangerNotified: false,
    texture: null,
    effects: {
      sparks: [],
      waves: [],
      texts: [],
      puffs: [],
      wallFlashes: [],
      blackdogEntrances: [],
    },
    ambient: [],
    arenaDust: [],
    bannerTimer: null,
    uiTimer: 0,
    lastFrame: performance.now() / 1000,
    flash: {
      alpha: 0,
      color: '255,209,102',
    },
  };

  let rosterEls = {};

  /* =========================================================
     Initialisation
     ========================================================= */
  function initRoster() {
    dom.rosterList.innerHTML = '';
    rosterEls = {};
  }

  function arrangeRoster(ids) {
    const activeIds = Array.isArray(ids) ? ids : [];
    dom.rosterList.innerHTML = '';
    rosterEls = {};
    activeIds.forEach((id, index) => {
      const coin = G.coins.find((c) => c.id === id);
      if (!coin) return;
      const def = coin.def;
      const row = document.createElement('div');
      row.className = 'roster-row';
      row.style.setProperty('--coin-color', def.color);
      row.innerHTML = `
        <span class="coin-indicator"></span>
        <span class="roster-name">
          <strong><span class="roster-order">${String(index + 1).padStart(2, '0')}</span>${def.name}<em class="you-tag">YOU</em><em class="roster-shield" title="首发保护">护</em></strong>
          <small>${def.role}</small>
        </span>
        <span class="roster-status">待命</span>
      `;
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-label', `查看${def.name}的技能与本局状态`);
      row.title = '查看硬币技能 (C)';
      row.addEventListener('click', () => openInspect(coin.id));
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openInspect(coin.id);
        }
      });
      dom.rosterList.appendChild(row);
      rosterEls[coin.id] = {
        row,
        status: row.querySelector('.roster-status'),
        order: row.querySelector('.roster-order'),
      };
    });
  }

  function shuffleList(list) {
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  function participantTypeId(id) {
    return String(id || '').split('#')[0];
  }

  function participantDef(id) {
    return DEF_BY_ID[id] || DEF_BY_ID[participantTypeId(id)] || COIN_DEFS[0];
  }

  function buildParticipantIds(count, randomize) {
    const total = clamp(Math.round(Number(count) || 2), 2, 24);
    const ids = [G.playerId];
    const used = new Set(ids);
    const bases = COIN_DEFS.map((def) => def.id).filter((id) => id !== G.playerId);
    const order = randomize ? shuffleList(bases.slice()) : bases.slice();
    for (const base of order) {
      if (ids.length >= total) break;
      if (used.has(base)) continue;
      ids.push(base);
      used.add(base);
    }
    let cursor = 0;
    while (ids.length < total) {
      const pool = randomize ? null : COIN_DEFS;
      const base = pool
        ? pool[cursor++ % pool.length].id
        : COIN_DEFS[Math.floor(Math.random() * COIN_DEFS.length)].id;
      let id = base;
      let suffix = 2;
      while (used.has(id)) {
        id = `${base}#${suffix}`;
        suffix += 1;
      }
      used.add(id);
      ids.push(id);
    }
    return randomize ? shuffleList(ids) : ids;
  }

  function pickParticipantIds() {
    return buildParticipantIds(G.matchSize, true);
  }

  function previewParticipantIds() {
    return buildParticipantIds(G.matchSize, false);
  }

  function seatAnglesFor(ids) {
    const seatOrder = [G.playerId, ...ids.filter((id) => id !== G.playerId)];
    const count = Math.max(1, ids.length);
    const map = {};
    seatOrder.forEach((id, index) => {
      map[id] = Math.PI / 2 + (index / count) * TAU;
    });
    return map;
  }

  function coinTypeSeed(id) {
    let hash = 2166136261;
    for (let i = 0; i < id.length; i += 1) {
      hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
    }
    return hash >>> 0;
  }

  function coinTypeRotation(id) {
    return (coinTypeSeed(id) % 360) * Math.PI / 180;
  }

  function createCoins(preview = false) {
    const online = !preview && !!(G.online && G.online.active);
    const ids = preview ? previewParticipantIds() : (G.participants.length ? G.participants : pickParticipantIds());
    if (!preview && !G.participants.length) G.participants = ids.slice();
    const typeCounts = new Map();
    const typeFirstIndex = new Map();
    ids.forEach((id, index) => {
      const type = participantTypeId(id);
      typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
      if (!typeFirstIndex.has(type)) typeFirstIndex.set(type, index);
    });
    const spawnRadius = getArenaSpawnRadius();
    const seatAngles = online
      ? Object.fromEntries(ids.map((id, i) => [id, Math.PI / 2 + (i / ids.length) * TAU]))
      : seatAnglesFor(ids);

    return ids.map((id, i) => {
      const def = participantDef(id);
      const type = participantTypeId(id);
      const typeSeed = coinTypeSeed(type);
      const jitter = preview || online ? 0 : rand(-0.04, 0.04);
      const angle = (seatAngles[id] ?? (Math.PI / 2 + (i / ids.length) * TAU)) + jitter;
      const d = spawnRadius + (preview || online ? 0 : rand(-12, 12));
      return {
        id,
        def,
        name: def.name,
        index: i,
        visualSeed: typeSeed,
        color: def.color,
        rgb: def.rgb,
        radius: def.radius,
        mass: def.mass,
        x: Math.cos(angle) * d,
        y: Math.sin(angle) * d,
        vx: 0,
        vy: 0,
        rot: typeCounts.get(type) > 1
          ? coinTypeRotation(type)
          : (preview || online ? i * 1.7 : rand(-Math.PI, Math.PI)),
        spin: 0,
        alive: true,
        active: false,
        out: false,
        fall: 0,
        spawn: preview ? 1 : 0,
        spawnDelay: preview ? 0 : (typeFirstIndex.get(type) ?? i) * 0.065,
        flash: 0,
        squash: 0,
        trail: [],
        curveTrail: [],
        trailT: 0,
        curveTrailT: 0,
        dustT: 0,
        lastHitBy: null,
        danger: 0,
        speed: 0,
        hasFired: false,
        volleySkipped: false,
        marker: null,
        skillCooldown: 0,
        skillReady: true,
        energy: def.id === 'curve' ? 100 : 0,
        curveHold: 0,
        remoteCurveRight: false,
        remoteCurveLeft: false,
        blackdogFxTriggered: false,
        anchorHeld: false,
        anchorX: 0,
        anchorY: 0,
        anchorAiTimer: 0,
        personality: null,
        aiRecallTimer: 0,
        aiWillRecall: false,
        frictionScale: def.frictionScale || 1,
        chainUsed: false,
        skillBurst: false,
        prevX: Math.cos(angle) * d,
        prevY: Math.sin(angle) * d,
        targetX: Math.cos(angle) * d,
        targetY: Math.sin(angle) * d,
        syncT: 1,
      };
    });
  }

  function buildArenaTexture() {
    const extent = ARENA_TEXTURE_EXTENT;
    const size = 2560;
    const scale = size / (extent * 2);
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    g.translate(size / 2, size / 2);
    g.scale(scale, scale);

    let seed = 9173;
    const seeded = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    g.save();

    const base = g.createRadialGradient(-150, -180, 10, 0, 0, extent * 1.06);
    base.addColorStop(0, '#14363a');
    base.addColorStop(0.33, '#0e282c');
    base.addColorStop(0.72, '#081b1e');
    base.addColorStop(1, '#050f11');
    g.fillStyle = base;
    g.fillRect(-extent, -extent, extent * 2, extent * 2);

    // Hex inlay
    g.strokeStyle = 'rgba(104, 227, 209, 0.075)';
    g.lineWidth = 0.9;
    const hs = 48;
    const hw = Math.sqrt(3) * hs;
    for (let row = -14; row <= 14; row += 1) {
      for (let col = -14; col <= 14; col += 1) {
        const cx = col * hw + (row % 2 ? hw / 2 : 0);
        const cy = row * hs * 1.5;
        if (Math.hypot(cx, cy) > extent + hs) continue;
        g.beginPath();
        for (let k = 0; k < 6; k += 1) {
          const a = Math.PI / 3 * k + Math.PI / 6;
          const px = cx + Math.cos(a) * hs * 0.94;
          const py = cy + Math.sin(a) * hs * 0.94;
          if (k === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath();
        g.stroke();
      }
    }

    // Concentric rings and spokes
    g.strokeStyle = 'rgba(118, 240, 223, 0.09)';
    g.lineWidth = 1;
    [118, 238, 356, 462, 580, 700].forEach((r, idx) => {
      g.beginPath();
      g.arc(0, 0, r, 0, TAU);
      g.setLineDash(idx % 2 ? [2, 13] : []);
      g.stroke();
    });
    g.setLineDash([]);

    g.strokeStyle = 'rgba(130, 238, 222, 0.035)';
    for (let i = 0; i < 24; i += 1) {
      const a = i / 24 * TAU;
      g.beginPath();
      g.moveTo(Math.cos(a) * 90, Math.sin(a) * 90);
      g.lineTo(Math.cos(a) * (extent - 34), Math.sin(a) * (extent - 34));
      g.stroke();
    }

    // Centre emblem
    g.save();
    g.translate(0, 0);
    g.globalAlpha = 0.18;
    g.strokeStyle = '#7ef0df';
    g.lineWidth = 1.2;
    g.beginPath();
    g.arc(0, 0, 188, 0, TAU);
    g.stroke();
    g.beginPath();
    g.arc(0, 0, 150, 0, TAU);
    g.stroke();
    g.setLineDash([3, 8]);
    g.beginPath();
    g.arc(0, 0, 104, 0, TAU);
    g.stroke();
    g.setLineDash([]);
    for (let i = 0; i < 8; i += 1) {
      const a = i / 8 * TAU;
      const long = i % 2 === 0 ? 44 : 23;
      g.beginPath();
      g.moveTo(Math.cos(a) * 112, Math.sin(a) * 112);
      g.lineTo(Math.cos(a) * (112 + long), Math.sin(a) * (112 + long));
      g.stroke();
      g.beginPath();
      g.arc(Math.cos(a) * 188, Math.sin(a) * 188, i % 2 ? 2 : 3.5, 0, TAU);
      g.fillStyle = i % 2 ? 'rgba(126,240,223,0.35)' : 'rgba(255,209,102,0.45)';
      g.fill();
    }
    g.fillStyle = 'rgba(169, 240, 229, 0.22)';
    g.font = '600 19px "Bahnschrift", "Segoe UI", sans-serif';
    g.textAlign = 'center';
    g.letterSpacing = '7px';
    g.fillText('EDGE // COIN', 0, 6);
    g.font = '500 9px "Cascadia Mono", monospace';
    g.fillStyle = 'rgba(169, 240, 229, 0.16)';
    g.fillText('PLAYFIELD 01 · NO WALLS', 0, 26);
    g.beginPath();
    g.arc(0, 0, 72, 0, TAU);
    g.strokeStyle = 'rgba(255, 209, 102, 0.22)';
    g.lineWidth = 1;
    g.stroke();
    g.beginPath();
    g.arc(0, 0, 17, 0, TAU);
    g.fillStyle = 'rgba(255, 209, 102, 0.20)';
    g.fill();
    g.restore();

    // Scuffs / floor scratches
    g.lineCap = 'round';
    for (let i = 0; i < 34; i += 1) {
      const a = seeded() * TAU;
      const rr = 100 + seeded() * (extent - 150);
      const len = 8 + seeded() * 38;
      const spread = (seeded() - 0.5) * 0.3;
      g.beginPath();
      g.strokeStyle = `rgba(173, 234, 224, ${0.018 + seeded() * 0.022})`;
      g.lineWidth = 0.7 + seeded() * 1.2;
      g.arc(0, 0, rr, a, a + len / rr);
      g.stroke();
      g.beginPath();
      g.arc(0, 0, rr + 24, a + spread, a + spread + len / (rr + 24) * 1.4);
      g.stroke();
    }

    // Fine dust specks
    for (let i = 0; i < 520; i += 1) {
      const a = seeded() * TAU;
      const rr = Math.sqrt(seeded()) * (extent - 8);
      g.fillStyle = `rgba(186, 243, 232, ${0.02 + seeded() * 0.035})`;
      g.beginPath();
      g.arc(Math.cos(a) * rr, Math.sin(a) * rr, 0.45 + seeded() * 0.7, 0, TAU);
      g.fill();
    }

    g.restore();
    return { canvas: c, extent };
  }

  function initAmbient() {
    G.ambient = [];
    for (let i = 0; i < 90; i += 1) {
      G.ambient.push({
        x: rand(0, G.width),
        y: rand(0, G.height),
        r: rand(0.35, 1.5),
        a: rand(0.04, 0.19),
        vx: rand(-3, 3),
        vy: rand(-6, -1),
        phase: rand(0, TAU),
      });
    }
    G.arenaDust = [];
    let dustTries = 0;
    while (G.arenaDust.length < 34 && dustTries < 400) {
      dustTries += 1;
      const a = rand(0, TAU);
      const d = Math.sqrt(rand(0, 1)) * (R - 26);
      const x = Math.cos(a) * d;
      const y = Math.sin(a) * d;
      if (!isInsideArena(x, y, -12)) continue;
      G.arenaDust.push({
        x,
        y,
        r: rand(0.5, 1.8),
        a: rand(0.03, 0.15),
        phase: rand(0, TAU),
        drift: rand(0.1, 0.7),
      });
    }
  }

  function updateProjection() {
    const availableW = G.width - (G.width > 900 ? 120 : 32);
    const topSafe = G.width > 760 ? 86 : 70;
    const bottomSafe = G.width > 760 ? 166 : 160;
    const availableH = G.height - topSafe - bottomSafe;
    const widthFit = availableW / (R * 2);
    const heightFit = availableH / (R * 2);
    G.baseZoom = clamp(Math.min(widthFit, heightFit), 0.18, 1.08);

    // When height is the limiting dimension, lift the table out from under
    // the bottom HUD so the full rim stays visible.
    const verticalLimited = heightFit <= widthFit;
    const safeCenterY = topSafe + availableH / 2;
    G.camera.homeX = 0;
    G.camera.homeY = verticalLimited
      ? (G.height / 2 - safeCenterY) / G.baseZoom
      : 0;
  }

  function resize() {
    const oldBase = G.baseZoom;
    G.width = window.innerWidth;
    G.height = window.innerHeight;
    G.dpr = Math.min(2, window.devicePixelRatio || 1);
    dom.canvas.width = Math.round(G.width * G.dpr);
    dom.canvas.height = Math.round(G.height * G.dpr);
    dom.canvas.style.width = `${G.width}px`;
    dom.canvas.style.height = `${G.height}px`;

    updateProjection();

    if (G.chase) {
      setChaseCamera(true);
      initAmbient();
      return;
    }

    if (!G.zoomAdjusted) {
      G.camera.zoom = G.baseZoom;
      G.camera.tzoom = G.baseZoom;
      G.camera.x = G.camera.homeX;
      G.camera.y = G.camera.homeY;
      G.camera.tx = G.camera.homeX;
      G.camera.ty = G.camera.homeY;
    } else {
      const ratio = G.camera.tzoom / (oldBase || G.baseZoom);
      G.camera.tzoom = clamp(G.baseZoom * ratio, G.baseZoom * 0.6, G.baseZoom * 2.8);
      G.camera.zoom = clamp(G.camera.zoom, G.baseZoom * 0.6, G.baseZoom * 2.8);
      clampCameraTarget();
    }

    initAmbient();
    updateZoomLabel();
  }

  /* =========================================================
     Camera
     ========================================================= */
  function screenToWorld(sx, sy) {
    const cam = G.camera;
    return {
      x: (sx - G.width / 2) / cam.zoom + cam.x,
      y: (sy - G.height / 2) / cam.zoom + cam.y,
    };
  }

  function worldToScreen(x, y) {
    const cam = G.camera;
    return {
      x: (x - cam.x) * cam.zoom + G.width / 2,
      y: (y - cam.y) * cam.zoom + G.height / 2,
    };
  }

  function clampCameraTarget() {
    const cam = G.camera;
    const halfW = G.width / (2 * cam.tzoom);
    const halfH = G.height / (2 * cam.tzoom);
    const panAllowance = PAN_MARGIN_PX / cam.tzoom;
    const limitX = Math.max(0, R + 46 - halfW) + panAllowance;
    const limitY = Math.max(0, R + 46 - halfH) + panAllowance;
    cam.tx = clamp(cam.tx, cam.homeX - limitX, cam.homeX + limitX);
    cam.ty = clamp(cam.ty, cam.homeY - limitY, cam.homeY + limitY);
  }

  function clearPanKeys() {
    G.panKeys.up = false;
    G.panKeys.down = false;
    G.panKeys.left = false;
    G.panKeys.right = false;
  }

  function updateKeyboardPan(dt) {
    const keys = G.panKeys;
    if (!keys.up && !keys.down && !keys.left && !keys.right) return;
    if (G.phase === 'menu' || G.phase === 'over' || G.paused || G.helpOpen
      || G.arenaOpen || G.resultOpen || G.aim.charging) {
      return;
    }
    let fx = 0;
    let fy = 0;
    if (keys.left) fx -= 1;
    if (keys.right) fx += 1;
    if (keys.up) fy -= 1;
    if (keys.down) fy += 1;
    if (fx === 0 && fy === 0) return;
    const len = Math.hypot(fx, fy) || 1;
    const stepWorld = (PAN_SPEED * dt) / G.camera.tzoom;
    // Standard map-style panning: the view moves in the arrow direction.
    G.camera.tx += (fx / len) * stepWorld;
    G.camera.ty += (fy / len) * stepWorld;
    G.camera.userPanned = true;
    clampCameraTarget();
    if (!G.panHintShown) {
      G.panHintShown = true;
      addToast('方向键平移视角 · 滚轮缩放', 'info', 2000);
    }
  }

  function zoomAt(sx, sy, factor) {
    const cam = G.camera;
    const before = screenToWorld(sx, sy);
    const next = clamp(cam.tzoom * factor, G.baseZoom * 0.6, G.baseZoom * 2.8);
    if (Math.abs(next - cam.tzoom) < 0.0001) return;
    cam.tzoom = next;
    cam.tx = before.x - (sx - G.width / 2) / next;
    cam.ty = before.y - (sy - G.height / 2) / next;
    clampCameraTarget();
    G.zoomAdjusted = Math.abs(cam.tzoom - G.baseZoom) > 0.008;
    updateZoomLabel();
  }

  function resetCamera(immediate = false) {
    const cam = G.camera;
    clearPanKeys();
    cam.userPanned = false;
    cam.tzoom = G.baseZoom;
    cam.tx = cam.homeX;
    cam.ty = cam.homeY;
    G.zoomAdjusted = false;
    if (immediate) {
      cam.zoom = G.baseZoom;
      cam.x = cam.homeX;
      cam.y = cam.homeY;
    }
    updateZoomLabel();
  }

  function updateZoomLabel() {
    const percent = Math.round((G.camera.tzoom / G.baseZoom) * 100);
    dom.zoomValue.textContent = `${percent}%`;
  }

  function updateCamera(dt) {
    const cam = G.camera;
    const k = 1 - Math.exp(-dt * 11);
    cam.zoom = lerp(cam.zoom, cam.tzoom, k);
    cam.x = lerp(cam.x, cam.tx, k);
    cam.y = lerp(cam.y, cam.ty, k);

    const shakeTarget = reduceMotion ? 0 : cam.shake;
    cam.shake *= Math.exp(-dt * 7.5);
    cam.shakeX = (Math.random() * 2 - 1) * shakeTarget;
    cam.shakeY = (Math.random() * 2 - 1) * shakeTarget;
    if (cam.shake < 0.08) cam.shake = 0;

    if (G.phase === 'menu') {
      const sway = reduceMotion ? 0 : Math.sin(G.menuTime * 0.19) * 4;
      const swayY = reduceMotion ? 0 : Math.cos(G.menuTime * 0.16) * 3;
      cam.x += (cam.homeX + sway - cam.x) * 0.006;
      cam.y += (cam.homeY + swayY - cam.y) * 0.006;
    }
  }

  function ensureActiveVisible() {
    if (!G.active) return;
    const screen = worldToScreen(G.active.x, G.active.y);
    const left = G.width > 980 ? 285 : (G.width > 760 ? 225 : 155);
    const right = G.width - 80;
    const top = 100;
    const bottom = G.height - (G.width > 760 ? 185 : 165);
    let dx = 0;
    let dy = 0;
    if (screen.x < left) dx = left - screen.x;
    else if (screen.x > right) dx = right - screen.x;
    if (screen.y < top) dy = top - screen.y;
    else if (screen.y > bottom) dy = bottom - screen.y;
    if (dx !== 0 || dy !== 0) {
      G.camera.tx -= dx / G.camera.tzoom;
      G.camera.ty -= dy / G.camera.tzoom;
      clampCameraTarget();
    }
  }

  function addShake(amount) {
    if (reduceMotion) return;
    G.camera.shake = Math.min(26, Math.max(G.camera.shake, amount));
  }

  function flashScreen(color, alpha) {
    G.flash.color = color;
    G.flash.alpha = Math.max(G.flash.alpha, alpha);
  }

  /* =========================================================
     Effects
     ========================================================= */
  function addSparks(x, y, count, colors, speed = 520, spread = TAU, direction = null) {
    const budget = count + Math.floor(10 * (G.phase === 'pending' ? 1 : 0));
    for (let i = 0; i < budget; i += 1) {
      if (G.effects.sparks.length > 440) break;
      const angle = direction === null
        ? rand(0, TAU)
        : direction + rand(-spread / 2, spread / 2);
      const v = rand(speed * 0.22, speed);
      G.effects.sparks.push({
        x,
        y,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v,
        life: rand(0.28, 0.88),
        maxLife: 0.88,
        size: rand(1.1, 3.5),
        color: colors[randInt(0, colors.length - 1)],
        drag: rand(1.6, 4.1),
      });
    }
  }

  function addWave(x, y, radius, color, life = 0.45, lineWidth = 1.5, fill = false) {
    if (G.effects.waves.length > 40) return;
    G.effects.waves.push({
      x,
      y,
      radius: 8,
      maxRadius: radius,
      color,
      life,
      maxLife: life,
      lineWidth,
      fill,
    });
  }

  function addPuff(x, y, count, color, speed = 80) {
    for (let i = 0; i < count; i += 1) {
      if (G.effects.puffs.length > 220) break;
      const a = rand(0, TAU);
      const v = rand(speed * 0.2, speed);
      G.effects.puffs.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: rand(0.3, 0.7),
        maxLife: 0.7,
        size: rand(1.5, 5),
        color,
        drag: rand(1, 2.5),
      });
    }
  }

  function addSparkBurstAtCoin(coin, angle, count, speed) {
    const x = coin.x + Math.cos(angle) * coin.radius;
    const y = coin.y + Math.sin(angle) * coin.radius;
    addSparks(
      x,
      y,
      count,
      [coin.color, shade(coin.color, 0.4), '#fff2c9'],
      speed,
      Math.PI * 0.75,
      angle,
    );
  }

  function addFloatingText(x, y, text, color = '#ffd166', size = 13, life = 0.9) {
    if (G.effects.texts.length > 21) return;
    G.effects.texts.push({
      x,
      y,
      text,
      color,
      size,
      life,
      maxLife: life,
    });
  }

  function clearEffects() {
    G.effects.sparks.length = 0;
    G.effects.waves.length = 0;
    G.effects.texts.length = 0;
    G.effects.puffs.length = 0;
    G.effects.wallFlashes.length = 0;
    G.effects.blackdogEntrances.length = 0;
    G.flash.alpha = 0;
  }

  function updateEffects(dt) {
    for (let i = G.effects.sparks.length - 1; i >= 0; i -= 1) {
      const p = G.effects.sparks[i];
      p.life -= dt;
      if (p.life <= 0) {
        G.effects.sparks.splice(i, 1);
        continue;
      }
      const drag = Math.exp(-p.drag * dt);
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = G.effects.puffs.length - 1; i >= 0; i -= 1) {
      const p = G.effects.puffs[i];
      p.life -= dt;
      if (p.life <= 0) {
        G.effects.puffs.splice(i, 1);
        continue;
      }
      const drag = Math.exp(-p.drag * dt);
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = G.effects.waves.length - 1; i >= 0; i -= 1) {
      const w = G.effects.waves[i];
      w.life -= dt;
      if (w.life <= 0) {
        G.effects.waves.splice(i, 1);
        continue;
      }
      const t = 1 - w.life / w.maxLife;
      w.radius = 8 + (w.maxRadius - 8) * easeOutCubic(t);
    }
    for (let i = G.effects.texts.length - 1; i >= 0; i -= 1) {
      const t = G.effects.texts[i];
      t.life -= dt;
      t.y -= 24 * dt;
      if (t.life <= 0) G.effects.texts.splice(i, 1);
    }
    for (let i = G.effects.wallFlashes.length - 1; i >= 0; i -= 1) {
      const flash = G.effects.wallFlashes[i];
      flash.life -= dt;
      if (flash.life <= 0) G.effects.wallFlashes.splice(i, 1);
    }
    for (let i = G.effects.blackdogEntrances.length - 1; i >= 0; i -= 1) {
      const entrance = G.effects.blackdogEntrances[i];
      entrance.life -= dt;
      if (entrance.life <= 0) G.effects.blackdogEntrances.splice(i, 1);
    }
    G.shrinkFlash = Math.max(0, G.shrinkFlash - dt * 1.8);
    G.flash.alpha *= Math.exp(-dt * 7.5);
    if (G.flash.alpha < 0.003) G.flash.alpha = 0;
  }

  function triggerBlackdogEntrance(coin) {
    if (!coin || coin.blackdogFxTriggered) return;
    coin.blackdogFxTriggered = true;
    coin.flash = 1;
    const x = coin.x;
    const y = coin.y;
    const r = coin.radius;
    addWave(x, y, r * 2.1, 'rgba(255,72,58,0.78)', 0.62, 4.2, false);
    addWave(x, y, r * 3.4, 'rgba(255,179,71,0.42)', 0.86, 2.1, false);
    addWave(x, y, r * 1.2, 'rgba(30,8,8,0.72)', 0.48, 9, false);
    addSparks(x, y, 44, ['#ff4b3e', '#ffb347', '#ffe6bd', '#241313'], 430, TAU);
    addPuff(x, y, 16, 'rgba(40,12,12,0.42)', 95);
    addFloatingText(x, y - r - 24, '黑狗', '#ffb347', 17, 1.15);
    addShake(12);
    flashScreen('255,74,60', 0.055);
    G.effects.blackdogEntrances.push({
      x,
      y,
      radius: r,
      life: 0.92,
      max: 0.92,
      seed: rand(0, 1000),
    });
    audio.ping(78, 0.48, 0.085, 'sawtooth', 0, 0.9);
    audio.ping(156, 0.28, 0.035, 'triangle', 0.03, 0.65);
  }

  function drawBlackdogEntrances() {
    if (!G.effects.blackdogEntrances.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const entrance of G.effects.blackdogEntrances) {
      const t = clamp(entrance.life / entrance.max, 0, 1);
      const age = 1 - t;
      const rx = entrance.radius;
      ctx.save();
      ctx.translate(entrance.x, entrance.y);
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, rx * 2.8);
      glow.addColorStop(0, `rgba(255,120,58,${0.18 * t})`);
      glow.addColorStop(1, 'rgba(255,72,48,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, rx * 2.8, 0, TAU);
      ctx.fill();
      for (let bolt = 0; bolt < 7; bolt += 1) {
        const baseAngle = entrance.seed + bolt / 7 * TAU + age * 0.4;
        const length = rx * (1.6 + (bolt % 3) * 0.48);
        ctx.strokeStyle = bolt % 2 === 0
          ? `rgba(255,94,58,${0.72 * t})`
          : `rgba(255,194,106,${0.62 * t})`;
        ctx.lineWidth = 1.2 + t * 1.6;
        ctx.beginPath();
        ctx.moveTo(Math.cos(baseAngle) * rx * 0.6, Math.sin(baseAngle) * rx * 0.6);
        for (let step = 1; step <= 4; step += 1) {
          const dist = rx * 0.6 + length * (step / 4);
          const jitter = (Math.sin(entrance.seed + bolt * 7.3 + step * 3.7 + age * 9) * 0.18);
          const angle = baseAngle + jitter;
          ctx.lineTo(Math.cos(angle) * dist, Math.sin(angle) * dist);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = `rgba(255,208,124,${0.5 * t})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, 0, rx * (1.05 + age * 1.5), 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  function updateAmbient(dt) {
    if (G.paused) return;
    G.ambient.forEach((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.phase += dt * 0.55;
      if (p.y < -4) {
        p.y = G.height + 4;
        p.x = rand(0, G.width);
      }
      if (p.x < -4) p.x = G.width + 4;
      if (p.x > G.width + 4) p.x = -4;
    });
  }

  /* =========================================================
     Match setup and flow
     ========================================================= */
  function resetStats() {
    G.stats.hits = 0;
    G.stats.kos = 0;
    G.stats.topSpeed = 0;
    G.stats.shots = 0;
    G.stats.elapsed = 0;
    G.stats.matchTime = 0;
  }

  function chaseKey(c, r) {
    return `${c},${r}`;
  }

  function chaseCellCenter(c, r) {
    return {
      x: (c - (CHASE_GRID - 1) / 2) * CHASE_CELL,
      y: (r - (CHASE_GRID - 1) / 2) * CHASE_CELL,
    };
  }

  function generateChaseMaze() {
    const n = CHASE_GRID;
    const cellSize = CHASE_CELL;
    const keepRadius = CHASE_RADIUS - cellSize * 0.72;
    const map = new Map();
    const list = [];
    for (let r = 0; r < n; r += 1) {
      for (let c = 0; c < n; c += 1) {
        const { x, y } = chaseCellCenter(c, r);
        if (Math.hypot(x, y) > keepRadius) continue;
        const cell = {
          c,
          r,
          key: chaseKey(c, r),
          x,
          y,
          walls: { n: true, e: true, s: true, w: true },
        };
        map.set(cell.key, cell);
        list.push(cell);
      }
    }
    const start = map.get(chaseKey((n - 1) / 2, (n - 1) / 2)) || list[0];
    if (!start) return null;

    const dirs = [
      ['n', 0, -1],
      ['e', 1, 0],
      ['s', 0, 1],
      ['w', -1, 0],
    ];
    const opposite = { n: 's', e: 'w', s: 'n', w: 'e' };
    const visited = new Set([start.key]);
    const stack = [start];
    while (stack.length) {
      const current = stack[stack.length - 1];
      const options = [];
      for (const [dir, dc, dr] of dirs) {
        const next = map.get(chaseKey(current.c + dc, current.r + dr));
        if (next && !visited.has(next.key)) options.push([dir, next]);
      }
      if (!options.length) {
        stack.pop();
        continue;
      }
      const [dir, next] = options[Math.floor(Math.random() * options.length)];
      current.walls[dir] = false;
      next.walls[opposite[dir]] = false;
      visited.add(next.key);
      stack.push(next);
    }

    // A few loops keep 7-enemy chases from becoming a single-file conga line.
    for (const cell of list) {
      for (const [dir, dc, dr] of [['e', 1, 0], ['s', 0, 1]]) {
        if (!cell.walls[dir]) continue;
        const next = map.get(chaseKey(cell.c + dc, cell.r + dr));
        if (!next || Math.random() > 0.055) continue;
        cell.walls[dir] = false;
        next.walls[opposite[dir]] = false;
      }
    }

    const horizontal = [];
    const vertical = [];
    for (const cell of list) {
      if (cell.walls.n) {
        horizontal.push({
          y: cell.y - cellSize / 2,
          a: cell.x - cellSize / 2,
          b: cell.x + cellSize / 2,
        });
      }
      if (cell.walls.w) {
        vertical.push({
          x: cell.x - cellSize / 2,
          a: cell.y - cellSize / 2,
          b: cell.y + cellSize / 2,
        });
      }
      if (cell.walls.s && !map.has(chaseKey(cell.c, cell.r + 1))) {
        horizontal.push({
          y: cell.y + cellSize / 2,
          a: cell.x - cellSize / 2,
          b: cell.x + cellSize / 2,
        });
      }
      if (cell.walls.e && !map.has(chaseKey(cell.c + 1, cell.r))) {
        vertical.push({
          x: cell.x + cellSize / 2,
          a: cell.y - cellSize / 2,
          b: cell.y + cellSize / 2,
        });
      }
    }

    const mergeRuns = (runs, fixedKey, startKey, endKey) => {
      runs.sort((a, b) => a[fixedKey] - b[fixedKey] || a[startKey] - b[startKey]);
      const out = [];
      for (const run of runs) {
        const last = out[out.length - 1];
        if (last && Math.abs(last[fixedKey] - run[fixedKey]) < 0.01
          && run[startKey] <= last[endKey] + 0.5) {
          last[endKey] = Math.max(last[endKey], run[endKey]);
        } else {
          out.push({ ...run });
        }
      }
      return out;
    };

    const hMerged = mergeRuns(horizontal, 'y', 'a', 'b');
    const vMerged = mergeRuns(vertical, 'x', 'a', 'b');
    const walls = [];
    for (const run of hMerged) {
      walls.push({
        x: run.a,
        y: run.y - CHASE_WALL / 2,
        w: Math.max(CHASE_WALL, run.b - run.a),
        h: CHASE_WALL,
      });
    }
    for (const run of vMerged) {
      walls.push({
        x: run.x - CHASE_WALL / 2,
        y: run.a,
        w: CHASE_WALL,
        h: Math.max(CHASE_WALL, run.b - run.a),
      });
    }

    return {
      n,
      cell: cellSize,
      radius: CHASE_RADIUS,
      map,
      list,
      walls,
      start,
    };
  }

  function chaseNearestCell(maze, x, y) {
    if (!maze) return null;
    const c = Math.round(x / maze.cell + (maze.n - 1) / 2);
    const r = Math.round(y / maze.cell + (maze.n - 1) / 2);
    const direct = maze.map.get(chaseKey(c, r));
    if (direct) return direct;
    let best = null;
    let bestD = Infinity;
    for (const cell of maze.list) {
      const d = (cell.x - x) ** 2 + (cell.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = cell;
      }
    }
    return best;
  }

  function chaseCellAt(maze, x, y) {
    return chaseNearestCell(maze, x, y);
  }

  function chaseNeighbors(maze, cell) {
    const out = [];
    const steps = [
      ['n', 0, -1],
      ['e', 1, 0],
      ['s', 0, 1],
      ['w', -1, 0],
    ];
    for (const [dir, dc, dr] of steps) {
      if (cell.walls[dir]) continue;
      const next = maze.map.get(chaseKey(cell.c + dc, cell.r + dr));
      if (next) out.push(next);
    }
    return out;
  }

  function chaseBfs(maze, from, to) {
    if (!maze || !from || !to) return [];
    if (from.key === to.key) return [from];
    const queue = [from];
    const head = new Set([from.key]);
    const parent = new Map();
    let index = 0;
    while (index < queue.length) {
      const current = queue[index];
      index += 1;
      for (const next of chaseNeighbors(maze, current)) {
        if (head.has(next.key)) continue;
        head.add(next.key);
        parent.set(next.key, current.key);
        if (next.key === to.key) {
          const path = [next];
          let key = next.key;
          while (parent.has(key)) {
            const prevKey = parent.get(key);
            const prevCell = maze.map.get(prevKey);
            if (!prevCell) break;
            path.unshift(prevCell);
            key = prevKey;
          }
          return path;
        }
        queue.push(next);
      }
    }
    return [];
  }

  function chaseFreeCellNear(maze, c, r) {
    for (let radius = 0; radius <= 4; radius += 1) {
      for (let dc = -radius; dc <= radius; dc += 1) {
        for (let dr = -radius; dr <= radius; dr += 1) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
          const cell = maze.map.get(chaseKey(c + dc, r + dr));
          if (cell) return cell;
        }
      }
    }
    return chaseNearestCell(maze, 0, 0);
  }

  function chaseDifficultyTuning() {
    const id = getAIDifficulty().id;
    if (id === 'easy') return { pulse: 2.25, speed: 0.82, burst: 0.78 };
    if (id === 'hard') return { pulse: 1.45, speed: 1.18, burst: 1.16 };
    return { pulse: 1.85, speed: 1, burst: 1 };
  }

  function setChaseCamera(immediate = false) {
    if (!G.chase || !G.chase.player) return;
    const cam = G.camera;
    const zoom = clamp(Math.min(G.width, G.height) / 1000, 0.55, 0.92);
    cam.zoom = immediate ? zoom : cam.zoom;
    cam.tzoom = zoom;
    cam.tx = G.chase.player.x;
    cam.ty = G.chase.player.y;
    if (immediate) {
      cam.x = cam.tx;
      cam.y = cam.ty;
      cam.homeX = cam.x;
      cam.homeY = cam.y;
      cam.shake = 0;
      cam.shakeX = 0;
      cam.shakeY = 0;
    }
  }

  function chaseSpawnCells(maze, start, exit, count) {
    const candidates = maze.list.filter((cell) => {
      const distStart = Math.hypot(cell.x - start.x, cell.y - start.y);
      const radial = Math.hypot(cell.x, cell.y);
      return cell !== start
        && cell !== exit
        && distStart > CHASE_CELL * 2.1
        && radial > CHASE_RADIUS * 0.56
        && cell.y > start.y + CHASE_CELL * 1.1
        && Math.hypot(cell.x - exit.x, cell.y - exit.y) > CHASE_CELL * 1.2;
    });
    const shuffled = shuffleList(candidates);
    if (shuffled.length >= count) return shuffled.slice(0, count);
    const fallback = shuffleList(maze.list.filter((cell) => {
      return cell !== start && cell !== exit
        && Math.hypot(cell.x - start.x, cell.y - start.y) > CHASE_CELL * 1.6;
    }));
    return shuffled.concat(fallback.filter((cell) => !shuffled.includes(cell))).slice(0, count);
  }

  function startChaseGame() {
    if (G.online && G.online.active) {
      addToast('联机对局中不能启动追击模式', 'info', 2000);
      return;
    }
    audio.init();
    closeHelp(true);
    closeArena(true);
    closeCodex(true);
    closeInspect(true);
    closeResult(true);
    closeQuitConfirm(true);
    closeAIPersona(true);
    G.obstacles = [];
    clearToasts();
    clearTimeout(G.bannerTimer);
    clearPanKeys();
    G.paused = false;
    G.phase = 'chase';
    G.mode = 'chase';
    G.resultOpen = false;
    G.playerOut = false;
    G.winnerId = null;
    G.active = null;
    G.activeIndex = -1;
    G.turn = 1;
    G.volley = null;
    G.anchorBonus = null;
    G.coins = [];
    G.participants = [];
    G.pending = null;
    G.chase = null;
    G.aim.charging = false;
    G.aim.power = 0;
    G.aim.chargeT = 0;
    G.aim.angle = -Math.PI / 2;
    G.pointer.down = false;
    dom.hud.classList.remove('is-chase');
    dom.chaseStatus.hidden = true;
    dom.shotClock.hidden = true;
    if (dom.shotClockBig) dom.shotClockBig.hidden = true;

    const maze = generateChaseMaze();
    if (!maze) {
      addToast('迷宫生成失败，请重试', 'out', 2500);
      G.phase = 'menu';
      return;
    }
    const startCell = chaseNearestCell(maze, 0, CHASE_RADIUS * 0.4);
    const minExit = CHASE_RADIUS * 0.5;
    const exitCandidates = maze.list.filter((cell) => {
      if (cell === startCell) return false;
      if (Math.hypot(cell.x - startCell.x, cell.y - startCell.y) < minExit) return false;
      return Math.hypot(cell.x, cell.y) < CHASE_RADIUS - CHASE_CELL * 0.5;
    });
    const exitCell = exitCandidates[Math.floor(Math.random() * exitCandidates.length)]
      || maze.list[maze.list.length - 1];
    const enemyCount = clamp(G.matchSize - 1, 1, 7);
    const spawnCells = chaseSpawnCells(maze, startCell, exitCell, enemyCount);
    const tuning = chaseDifficultyTuning();
    const playerDef = getPlayerDef();
    const player = {
      x: startCell.x,
      y: startCell.y,
      vx: 0,
      vy: 0,
      r: CHASE_PLAYER_R,
      def: playerDef,
      rot: -Math.PI / 2,
      spin: 0,
      flash: 0,
      trail: [],
      trailT: 0,
    };
    const defPool = shuffleList(COIN_DEFS.filter((def) => def.id !== playerDef.id));
    const enemies = spawnCells.map((cell, index) => {
      const role = CHASE_ROLES[index % CHASE_ROLES.length];
      const def = defPool[index % defPool.length];
      return {
        x: cell.x,
        y: cell.y,
        vx: 0,
        vy: 0,
        r: 23 + (index % 3),
        def,
        role,
        rot: rand(-Math.PI, Math.PI),
        spin: rand(-2, 2),
        flash: 0,
        trail: [],
        trailT: 0,
        path: [],
        pathIndex: 0,
        waypoint: null,
        burst: 0,
        pulseSerial: 0,
        respawnFlash: 0,
      };
    });

    G.chase = {
      maze,
      startCell,
      exitCell,
      exit: { x: exitCell.x, y: exitCell.y, r: 30 },
      player,
      enemies,
      hp: G.chaseHp,
      maxHp: G.chaseHp,
      hits: 0,
      moves: 0,
      totalMoves: 0,
      enemyActive: false,
      pulseTimer: 1.2,
      pulseInterval: tuning.pulse,
      pulseSerial: 0,
      pulseFlash: 0,
      volleyQueued: false,
      volleyDelay: 0,
      playerMoving: false,
      wasMoving: false,
      speedScale: tuning.speed,
      burstScale: tuning.burst,
      keys: { up: false, down: false, left: false, right: false },
      invuln: 0,
      elapsed: 0,
      over: false,
      hudTimer: 0,
      wallHitCooldown: 0,
    };

    resetStats();
    G.stats.elapsed = 0;
    G.stats.hits = 0;
    G.stats.kos = 0;
    G.stats.topSpeed = 0;
    clearEffects();
    G.slowmo = 0;
    G.timeScale = 1;
    G.combo = { count: 0, timer: 0, last: -10 };
    G.alive = enemies.length + 1;
    G.camera.shake = 0;
    G.camera.shakeX = 0;
    G.camera.shakeY = 0;
    setChaseCamera(true);

    dom.menu.classList.add('is-hidden');
    dom.menu.setAttribute('aria-hidden', 'true');
    dom.menu.inert = true;
    dom.hud.classList.add('is-visible');
    dom.hud.classList.add('is-chase');
    dom.hud.setAttribute('aria-hidden', 'false');
    dom.hud.inert = false;
    syncGameExitButtons();
    applyRosterVisibility();
    dom.chaseStatus.hidden = false;
    dom.result.classList.remove('is-open');
    dom.result.setAttribute('aria-hidden', 'true');
    dom.startBanner.classList.remove('is-visible');
    dom.roundFlash.classList.remove('is-flashing');
    void dom.roundFlash.offsetWidth;
    dom.roundFlash.classList.add('is-flashing');
    dom.comboBadge.classList.remove('is-visible');
    updateChaseHUD(true);
    showBanner(
      'HUNT',
      '迷宫追击',
      `${enemies.length} 名追兵 · ${G.chase.hp} 点生命 · 弹射 3 次后追兵苏醒`,
      2050,
    );
    audio.stopCharge();
    audio.turn();
    addWave(player.x, player.y, 70, 'rgba(80,231,212,0.26)', 0.8, 1.6, false);
  }

  function activateChaseHunt() {
    const ch = G.chase;
    if (!ch || ch.enemyActive || ch.over) return;
    ch.enemyActive = true;
    ch.pulseTimer = 0;
    ch.volleyDelay = 0;
    showBanner('ALERT', '追兵苏醒', `${ch.enemies.length} 名追兵 · 等你停稳后开始齐射`, 1600);
    addToast('追兵已经苏醒 · 停稳后他们会齐射', 'out', 2300);
    addShake(7);
    audio.ping(160, 0.4, 0.045, 'sine', 0, 0.7);
    audio.noiseBurst(0.4, 520, 0.7, 0.045, 'bandpass');
    addWave(ch.player.x, ch.player.y, 230, 'rgba(255,90,110,0.18)', 0.8, 2, false);
  }

  function canChaseAim() {
    const ch = G.chase;
    if (!ch || ch.over || G.helpOpen || G.resultOpen || G.paused) return false;
    return Math.hypot(ch.player.vx, ch.player.vy) < 18;
  }

  function startChaseCharge() {
    if (!canChaseAim() || G.aim.charging) return;
    const ch = G.chase;
    G.aim.angle = Math.atan2(
      G.pointer.worldY - ch.player.y,
      G.pointer.worldX - ch.player.x,
    );
    G.aim.chargeT = 0;
    G.aim.power = 0;
    G.aim.charging = true;
    ch.player.rot = G.aim.angle;
    audio.startCharge();
  }

  function cancelChaseCharge() {
    if (!G.chase) return;
    if (G.aim.charging) audio.stopCharge();
    G.aim.charging = false;
    G.aim.chargeT = 0;
    G.aim.power = 0;
    G.pointer.down = false;
  }

  function releaseChaseShot() {
    const ch = G.chase;
    if (!ch || ch.over) return;
    if (!G.aim.charging) return;
    if (!canChaseAim()) {
      cancelChaseCharge();
      return;
    }
    const power = clamp(G.aim.power, 0.07, 1);
    const speed = lerp(500, 1080, power);
    const player = ch.player;
    player.vx = Math.cos(G.aim.angle) * speed;
    player.vy = Math.sin(G.aim.angle) * speed;
    player.rot = G.aim.angle;
    player.spin = rand(-4.5, 4.5);
    ch.moves += 1;
    ch.totalMoves += 1;
    ch.wallHitCooldown = 0;
    G.stats.topSpeed = Math.max(G.stats.topSpeed, speed);
    G.aim.charging = false;
    G.aim.chargeT = 0;
    G.aim.power = 0;
    G.pointer.down = false;
    audio.stopCharge();
    audio.launch(power);
    addWave(player.x, player.y, player.r + 28, rgba(player.def.color, 0.55), 0.42, 1.5, false);
    addFloatingText(player.x, player.y - player.r - 20, '弹射', player.def.faceLight, 11, 0.9);
    addShake(2 + power * 2);
    if (ch.moves >= 3) activateChaseHunt();
    if (ch.enemyActive) ch.volleyQueued = true;
    updateChaseHUD(true);
  }

  function updateChaseAim(dt) {
    const ch = G.chase;
    if (!ch || ch.over) return;
    const player = ch.player;
    const world = screenToWorld(G.pointer.x, G.pointer.y);
    G.pointer.worldX = world.x;
    G.pointer.worldY = world.y;
    const canAim = canChaseAim();
    if ((canAim || G.aim.charging) && G.pointer.inside) {
      G.aim.angle = Math.atan2(world.y - player.y, world.x - player.x);
    }
    if (G.aim.charging) {
      if (!canChaseAim()) {
        cancelChaseCharge();
        return;
      }
      G.aim.chargeT += dt;
      G.aim.power = clamp(G.aim.chargeT / CHARGE_TIME, 0, 1);
      audio.updateCharge(G.aim.power);
    }
    if (Math.hypot(player.vx, player.vy) < 18) {
      player.rot = G.aim.angle;
    }
  }

  function updateChasePlayer(dt) {
    const ch = G.chase;
    const player = ch.player;
    const drag = Math.exp(-dt * 1.16);
    player.vx *= drag;
    player.vy *= drag;
    const speed = Math.hypot(player.vx, player.vy);
    if (speed < 18) {
      player.vx = 0;
      player.vy = 0;
    }
    moveChaseEntity(player, dt, true);
    if (Math.hypot(player.vx, player.vy) > 18) {
      player.rot = Math.atan2(player.vy, player.vx);
    }
    player.spin *= Math.exp(-dt * 5);
    player.trailT += dt;
    if (speed > 45 && player.trailT > 0.026) {
      player.trailT = 0;
      player.trail.push({ x: player.x, y: player.y, life: 0.32, max: 0.32 });
      if (player.trail.length > 18) player.trail.shift();
    }
    player.trail.forEach((point) => { point.life -= dt; });
    player.trail = player.trail.filter((point) => point.life > 0);
    G.stats.topSpeed = Math.max(G.stats.topSpeed, Math.hypot(player.vx, player.vy));
  }

  function chaseTargetCell(enemy) {
    const ch = G.chase;
    const maze = ch.maze;
    const player = ch.player;
    const playerCell = chaseCellAt(maze, player.x, player.y);
    if (!playerCell) return null;
    const offset = (enemy.role && enemy.role.target) || 'player';
    if (offset === 'flank') {
      const speed = Math.hypot(player.vx, player.vy);
      const angle = speed > 20 ? Math.atan2(player.vy, player.vx) + Math.PI / 2 : rand(0, TAU);
      return chaseNearestCell(
        maze,
        player.x + Math.cos(angle) * CHASE_CELL * 2.1,
        player.y + Math.sin(angle) * CHASE_CELL * 2.1,
      );
    }
    if (offset === 'lead') {
      return chaseNearestCell(
        maze,
        player.x + player.vx * 0.95,
        player.y + player.vy * 0.95,
      );
    }
    if (offset === 'block') {
      return chaseNearestCell(
        maze,
        lerp(player.x, ch.exit.x, 0.4),
        lerp(player.y, ch.exit.y, 0.4),
      );
    }
    if (offset === 'near') {
      const dc = enemy.nearSide || (Math.random() < 0.5 ? -2 : 2);
      return chaseFreeCellNear(maze, playerCell.c + dc, playerCell.r + Math.round(rand(-1, 1)));
    }
    return playerCell;
  }

  function freezeChaseEnemies() {
    const ch = G.chase;
    if (!ch) return;
    ch.enemies.forEach((enemy) => {
      enemy.vx = 0;
      enemy.vy = 0;
      enemy.burst = 0;
      enemy.flash = 0;
    });
    ch.pulseFlash = 0;
    ch.volleyDelay = 0;
  }

  function updateChaseEnemyPhase(moving) {
    const ch = G.chase;
    if (!ch) return;
    if (!ch.enemyActive) {
      ch.playerMoving = moving;
      ch.wasMoving = moving;
      return;
    }
    if (moving) {
      if (!ch.wasMoving) freezeChaseEnemies();
      ch.volleyDelay = 0;
      ch.playerMoving = true;
      ch.wasMoving = true;
      return;
    }
    if (ch.wasMoving && ch.volleyQueued) {
      ch.volleyDelay = 0.35;
    }
    ch.playerMoving = false;
    ch.wasMoving = false;
  }

  function chaseVolley() {
    const ch = G.chase;
    if (!ch || !ch.enemyActive || ch.over) return;
    ch.pulseSerial += 1;
    ch.pulseFlash = 0.62;
    ch.volleyQueued = false;
    ch.volleyDelay = 0;
    ch.enemies.forEach((enemy) => {
      const from = chaseCellAt(ch.maze, enemy.x, enemy.y);
      const target = chaseTargetCell(enemy);
      const path = from && target ? chaseBfs(ch.maze, from, target) : [];
      enemy.path = path;
      enemy.pathIndex = 1;
      enemy.waypoint = path[1] || path[0] || target;
      enemy.burst = 0.66;
      enemy.flash = 1;
      if (enemy.waypoint) {
        const dx = enemy.waypoint.x - enemy.x;
        const dy = enemy.waypoint.y - enemy.y;
        const len = Math.hypot(dx, dy) || 1;
        const boost = 360 * ch.burstScale * (enemy.role.speed || 1);
        enemy.vx = (dx / len) * boost;
        enemy.vy = (dy / len) * boost;
      }
      addWave(enemy.x, enemy.y, enemy.r + 28, rgba(enemy.def.color, 0.32), 0.28, 1.3, false);
    });
    addShake(2.5);
    audio.ping(146, 0.25, 0.04, 'sine', 0, 0.6);
    audio.ping(292, 0.12, 0.022, 'triangle', 0.02, 0.5);
  }

  function chaseAdvanceWaypoint(enemy) {
    if (!enemy.path || !enemy.path.length) {
      enemy.waypoint = null;
      return;
    }
    if (enemy.pathIndex >= enemy.path.length) {
      enemy.waypoint = null;
      return;
    }
    const cell = enemy.path[enemy.pathIndex];
    const dist = Math.hypot(cell.x - enemy.x, cell.y - enemy.y);
    if (dist < 13) {
      enemy.pathIndex += 1;
      if (enemy.pathIndex >= enemy.path.length) {
        enemy.waypoint = null;
        return;
      }
    }
    enemy.waypoint = enemy.path[enemy.pathIndex];
  }

  function updateChaseEnemies(dt) {
    const ch = G.chase;
    if (!ch.enemyActive) return;
    if (ch.playerMoving) {
      freezeChaseEnemies();
      return;
    }
    if (ch.volleyDelay > 0) {
      ch.volleyDelay -= dt;
      if (ch.volleyDelay <= 0) {
        ch.volleyDelay = 0;
        chaseVolley();
      }
      return;
    }
    ch.enemies.forEach((enemy) => {
      enemy.burst = Math.max(0, enemy.burst - dt);
      enemy.flash = Math.max(0, enemy.flash - dt * 4);
      if (enemy.burst > 0) {
        if (!enemy.waypoint) chaseAdvanceWaypoint(enemy);
        if (enemy.waypoint) {
          const dx = enemy.waypoint.x - enemy.x;
          const dy = enemy.waypoint.y - enemy.y;
          const len = Math.hypot(dx, dy) || 1;
          const desiredSpeed = 255 * ch.speedScale * (enemy.role.speed || 1);
          const steer = 1 - Math.exp(-dt * 9);
          enemy.vx = lerp(enemy.vx, (dx / len) * desiredSpeed, steer);
          enemy.vy = lerp(enemy.vy, (dy / len) * desiredSpeed, steer);
        }
      } else {
        const damp = Math.exp(-dt * 8);
        enemy.vx *= damp;
        enemy.vy *= damp;
        if (Math.hypot(enemy.vx, enemy.vy) < 6) {
          enemy.vx = 0;
          enemy.vy = 0;
        }
      }
      if (Math.hypot(enemy.vx, enemy.vy) > 1) {
        moveChaseEntity(enemy, dt, false);
      }
      if (Math.hypot(enemy.vx, enemy.vy) > 20) {
        enemy.rot = Math.atan2(enemy.vy, enemy.vx);
      }
      enemy.spin *= Math.exp(-dt * 4);
      enemy.trailT += dt;
      if (Math.hypot(enemy.vx, enemy.vy) > 40 && enemy.trailT > 0.04) {
        enemy.trailT = 0;
        enemy.trail.push({ x: enemy.x, y: enemy.y, life: 0.28, max: 0.28 });
        if (enemy.trail.length > 12) enemy.trail.shift();
      }
      enemy.trail.forEach((point) => { point.life -= dt; });
      enemy.trail = enemy.trail.filter((point) => point.life > 0);
      if (chaseAdvanceWaypoint && enemy.waypoint) {
        if (Math.hypot(enemy.waypoint.x - enemy.x, enemy.waypoint.y - enemy.y) < 12) {
          chaseAdvanceWaypoint(enemy);
        }
      }
    });
    // A light separation keeps seven pursuers from stacking into one pixel.
    for (let i = 0; i < ch.enemies.length; i += 1) {
      for (let j = i + 1; j < ch.enemies.length; j += 1) {
        const a = ch.enemies[i];
        const b = ch.enemies[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        const minDist = (a.r + b.r) * 0.78;
        if (dist >= minDist) continue;
        const push = (minDist - dist) * 0.5;
        a.x -= (dx / dist) * push;
        a.y -= (dy / dist) * push;
        b.x += (dx / dist) * push;
        b.y += (dy / dist) * push;
      }
    }
  }

  function resolveChaseWalls(entity) {
    const ch = G.chase;
    if (!ch) return;
    const radius = entity.r;
    for (let pass = 0; pass < 2; pass += 1) {
      for (const wall of ch.maze.walls) {
        const closestX = clamp(entity.x, wall.x, wall.x + wall.w);
        const closestY = clamp(entity.y, wall.y, wall.y + wall.h);
        let dx = entity.x - closestX;
        let dy = entity.y - closestY;
        let dist = Math.hypot(dx, dy);
        if (dist >= radius) continue;
        if (dist < 0.0001) {
          const left = entity.x - wall.x;
          const right = wall.x + wall.w - entity.x;
          const top = entity.y - wall.y;
          const bottom = wall.y + wall.h - entity.y;
          const min = Math.min(left, right, top, bottom);
          if (min === left) { dx = -1; dy = 0; dist = 0; }
          else if (min === right) { dx = 1; dy = 0; dist = 0; }
          else if (min === top) { dx = 0; dy = -1; dist = 0; }
          else { dx = 0; dy = 1; dist = 0; }
          entity.x = closestX + dx * (radius + 0.1);
          entity.y = closestY + dy * (radius + 0.1);
        } else {
          const nx = dx / dist;
          const ny = dy / dist;
          entity.x += nx * (radius - dist + 0.05);
          entity.y += ny * (radius - dist + 0.05);
        }
        const nx = dx / (dist || 1);
        const ny = dy / (dist || 1);
        const vn = entity.vx * nx + entity.vy * ny;
        if (vn < 0) {
          entity.vx -= (1 + CHASE_WALL_BOUNCE) * vn * nx;
          entity.vy -= (1 + CHASE_WALL_BOUNCE) * vn * ny;
          entity.vx *= 0.985;
          entity.vy *= 0.985;
          if (entity === ch.player && ch.wallHitCooldown <= 0 && Math.hypot(entity.vx, entity.vy) > 120) {
            ch.wallHitCooldown = 0.12;
            addSparks(entity.x + nx * radius, entity.y + ny * radius, 4, [entity.def.color, '#d8fff8'], 90, Math.PI * 0.5, Math.atan2(ny, nx));
            addShake(1.2);
          }
        }
      }
    }
  }

  function resolveChaseBoundary(entity) {
    const ch = G.chase;
    if (!ch) return;
    const dist = Math.hypot(entity.x, entity.y);
    const limit = CHASE_RADIUS - entity.r;
    if (dist <= limit) return;
    const nx = entity.x / (dist || 1);
    const ny = entity.y / (dist || 1);
    entity.x = nx * limit;
    entity.y = ny * limit;
    const vn = entity.vx * nx + entity.vy * ny;
    if (vn > 0) {
      entity.vx -= (1 + 0.6) * vn * nx;
      entity.vy -= (1 + 0.6) * vn * ny;
      entity.vx *= 0.985;
      entity.vy *= 0.985;
    }
  }

  function moveChaseEntity(entity, dt, isPlayer) {
    const speed = Math.hypot(entity.vx, entity.vy);
    const steps = clamp(Math.ceil((speed * dt) / 7), 1, 9);
    const step = dt / steps;
    for (let i = 0; i < steps; i += 1) {
      entity.x += entity.vx * step;
      entity.y += entity.vy * step;
      resolveChaseWalls(entity);
      resolveChaseBoundary(entity);
    }
    if (isPlayer) {
      entity.flash = Math.max(0, entity.flash - dt * 4);
    }
  }

  function teleportChaseEnemy(enemy) {
    const ch = G.chase;
    if (!ch) return;
    const candidates = ch.maze.list.filter((cell) => {
      const radial = Math.hypot(cell.x, cell.y);
      return cell !== ch.exitCell
        && radial > CHASE_RADIUS * 0.72
        && Math.hypot(cell.x - ch.player.x, cell.y - ch.player.y) > 480;
    });
    const cell = candidates.length
      ? candidates[Math.floor(Math.random() * candidates.length)]
      : chaseNearestCell(ch.maze, 0, CHASE_RADIUS * 0.82);
    if (!cell) return;
    enemy.x = cell.x;
    enemy.y = cell.y;
    enemy.vx = 0;
    enemy.vy = 0;
    enemy.path = [];
    enemy.pathIndex = 0;
    enemy.waypoint = null;
    enemy.burst = 0;
    enemy.flash = 1;
    enemy.respawnFlash = 1;
    addWave(cell.x, cell.y, enemy.r + 34, rgba(enemy.def.color, 0.5), 0.5, 1.8, false);
    addFloatingText(cell.x, cell.y - enemy.r - 18, '驱逐', enemy.def.faceLight, 10, 1.1);
  }

  function damageChasePlayer(enemy) {
    const ch = G.chase;
    if (!ch || ch.invuln > 0 || ch.over) return;
    ch.hp -= 1;
    ch.hits += 1;
    G.stats.hits += 1;
    ch.invuln = 1.55;
    cancelChaseCharge();
    ch.player.flash = 1;
    const dx = ch.player.x - enemy.x;
    const dy = ch.player.y - enemy.y;
    const len = Math.hypot(dx, dy) || 1;
    ch.player.vx += (dx / len) * 270;
    ch.player.vy += (dy / len) * 270;
    addShake(17);
    flashScreen('255, 80, 100', 0.06);
    audio.noiseBurst(0.4, 260, 0.68, 0.1, 'lowpass');
    audio.ping(86, 0.42, 0.06, 'sine', 0, 0.72);
    addToast(`被追兵撞到 · 损失 1 点生命（剩余 ${ch.hp}）`, 'out', 2600);
    updateChaseHUD(true);
    if (ch.hp <= 0) finishChase(false);
  }

  function checkChaseHits() {
    const ch = G.chase;
    if (!ch || ch.over || ch.invuln > 0) return;
    const hits = [];
    for (const enemy of ch.enemies) {
      const dist = Math.hypot(enemy.x - ch.player.x, enemy.y - ch.player.y);
      if (dist < enemy.r + ch.player.r - 2) hits.push(enemy);
    }
    if (!hits.length) return;
    damageChasePlayer(hits[0]);
    hits.forEach((enemy) => teleportChaseEnemy(enemy));
  }

  function checkChaseExit() {
    const ch = G.chase;
    if (!ch || ch.over) return;
    const dist = Math.hypot(ch.player.x - ch.exit.x, ch.player.y - ch.exit.y);
    if (dist < ch.exit.r + ch.player.r - 4) finishChase(true);
  }

  function updateChase(dt) {
    const ch = G.chase;
    if (!ch) return;
    if (ch.over || G.helpOpen || G.resultOpen || G.paused) {
      updateEffects(dt);
      updateCamera(dt);
      return;
    }
    G.stats.elapsed += dt;
    G.stats.matchTime = G.stats.elapsed;
    G.time += dt;
    ch.elapsed += dt;
    ch.invuln = Math.max(0, ch.invuln - dt);
    ch.pulseFlash = Math.max(0, ch.pulseFlash - dt);
    ch.wallHitCooldown = Math.max(0, ch.wallHitCooldown - dt);
    ch.player.flash = Math.max(0, ch.player.flash - dt * 4);
    updateChasePlayer(dt);
    updateChaseAim(dt);
    const playerMoving = Math.hypot(ch.player.vx, ch.player.vy) >= 18;
    updateChaseEnemyPhase(playerMoving);
    if (!ch.over) updateChaseEnemies(dt);
    if (!ch.over) checkChaseHits();
    if (!ch.over) checkChaseExit();
    updateEffects(dt);
    setChaseCamera(false);
    updateCamera(dt);
    ch.hudTimer += dt;
    if (ch.hudTimer > 0.07) {
      ch.hudTimer = 0;
      updateChaseHUD(false);
    }
    if (G.pointer.charging) G.pointer.charging = false;
  }

  function updateChaseHUD(force = false) {
    const ch = G.chase;
    if (!ch || G.phase === 'menu') return;
    if (dom.chaseStatus) dom.chaseStatus.hidden = false;
    dom.turnDock.classList.remove('ai-turn', 'is-danger', 'is-spectator');
    dom.turnKicker.textContent = '追击 · 迷宫逃脱';
    const dist = Math.hypot(ch.exit.x - ch.player.x, ch.exit.y - ch.player.y);
    const meters = Math.round(dist / 10);
    const sliding = Math.hypot(ch.player.vx, ch.player.vy) >= 18;
    if (sliding) {
      dom.turnTitle.textContent = '弹射滑行中';
      dom.turnHint.textContent = '追兵停火中 · 等你停稳后才会齐射';
    } else if (!ch.enemyActive) {
      dom.turnTitle.textContent = '瞄准并弹射';
      dom.turnHint.textContent = `按住左键蓄力，松开弹射 · 再弹射 ${Math.max(0, 3 - ch.moves)} 次追兵苏醒`;
    } else if (ch.volleyDelay > 0) {
      dom.turnTitle.textContent = '追兵准备齐射';
      dom.turnHint.textContent = '已停稳 · 追兵即将齐射，准备下一次弹射';
    } else if (ch.pulseFlash > 0) {
      dom.turnTitle.textContent = '追兵齐射！';
      dom.turnHint.textContent = '按住左键蓄力弹射 · 利用转角与墙壁反弹';
    } else if (dist < 420) {
      dom.turnTitle.textContent = '出口就在附近';
      dom.turnHint.textContent = '瞄准出口弹射 · 追兵已停歇';
    } else {
      dom.turnTitle.textContent = '瞄准并弹射';
      dom.turnHint.textContent = '追兵已停歇 · 再次弹射停稳后他们会再齐射';
    }
    dom.chasePowerFill.style.width = `${Math.round(G.aim.power * 100)}%`;
    dom.chasePowerText.textContent = `${Math.round(G.aim.power * 100)}%`;
    if (force || ch.hudHp !== ch.hp) {
      ch.hudHp = ch.hp;
      dom.chaseHearts.innerHTML = Array.from({ length: ch.maxHp }, (_, i) => {
        return `<span class="${i < ch.hp ? '' : 'is-lost'}">♥</span>`;
      }).join('');
      dom.chaseHearts.setAttribute('aria-label', `生命值 ${ch.hp} / ${ch.maxHp}`);
    }
    dom.chaseExit.textContent = `${meters} m`;
    dom.chaseMoveLabel.textContent = ch.enemyActive ? '状态' : '起步';
    dom.chaseMove.textContent = ch.enemyActive ? '已苏醒' : `${ch.moves}/3`;
    let enemyState = '待命';
    if (ch.enemyActive) {
      if (ch.playerMoving) enemyState = '停火 · 等你停稳';
      else if (ch.volleyDelay > 0) enemyState = '准备齐射';
      else if (ch.pulseFlash > 0) enemyState = '齐射中';
      else enemyState = '停歇';
    }
    dom.chaseEnemyNote.textContent = `追兵 ${ch.enemies.length} · ${enemyState}`;
    dom.chaseEnemyNote.classList.toggle('is-hot', ch.pulseFlash > 0 || ch.volleyDelay > 0);
    dom.liveLabel.textContent = '追击 · 迷宫';
    dom.arenaLabel.textContent = `出口 ${meters} m`;
    dom.aliveLabel.textContent = `生命 ${ch.hp}`;
    dom.speedCounter.textContent = `${Math.round(Math.hypot(ch.player.vx, ch.player.vy) * 0.1)} km/h`;
    dom.timeCounter.textContent = formatTime(G.stats.elapsed);
    if (dom.difficultyLabel) dom.difficultyLabel.textContent = '追兵';
    if (dom.difficultyCounter) dom.difficultyCounter.textContent = `${ch.enemies.length} 名`;
  }

  function setResultStatLabels(labels) {
    if (!dom.resultStatLabels) return;
    dom.resultStatLabels.forEach((el, index) => {
      if (labels[index]) el.textContent = labels[index];
    });
  }

  function finishChase(win) {
    const ch = G.chase;
    if (!ch || ch.over) return;
    ch.over = true;
    G.phase = 'over';
    G.resultOpen = true;
    cancelChaseCharge();
    G.stats.matchTime = G.stats.elapsed;
    ch.keys = { up: false, down: false, left: false, right: false };
    const playerDef = ch.player.def;
    dom.result.style.setProperty('--result-rgb', playerDef.rgb);
    dom.result.style.setProperty('--result-color', playerDef.color);
    dom.result.style.setProperty('--result-light', playerDef.faceLight);
    dom.result.style.setProperty('--result-dark', playerDef.faceDark);
    dom.result.classList.toggle('is-defeat', !win);
    dom.resultKicker.textContent = win ? 'ESCAPE COMPLETE' : 'CAPTURED';
    dom.resultTime.textContent = formatTime(G.stats.matchTime);
    dom.resultEyebrow.textContent = win ? 'MAZE ESCAPE' : 'THE HUNT ENDS';
    dom.resultTitle.textContent = win ? '逃出生天' : '被追上了';
    dom.resultSub.textContent = win
      ? `你穿过迷宫找到了出口，带着 ${ch.hp} 点生命甩开了 ${ch.enemies.length} 名追兵。`
      : `生命耗尽。出口还在迷宫深处，下一次记得利用转角和折返点。`;
    setResultStatLabels(['逃离结果', '碰撞次数', '弹射次数', '总用时']);
    dom.statKOs.textContent = win ? '成功' : '失败';
    dom.statHits.textContent = String(ch.hits);
    dom.statSpeed.textContent = String(ch.totalMoves);
    dom.statTime.textContent = formatTime(G.stats.matchTime);
    const againLabel = dom.playAgainBtn.querySelector('span');
    if (againLabel) againLabel.textContent = '再试一次';
    dom.playAgainBtn.disabled = false;
    dom.returnRoomBtn.hidden = true;
    dom.backToMenuBtn.textContent = '返回主菜单';
    dom.result.classList.add('is-open');
    dom.result.setAttribute('aria-hidden', 'false');
    dom.hud.inert = true;
    syncGameExitButtons();
    applyRosterVisibility();
    updateChaseHUD(true);
    if (win) audio.win();
    else audio.lose();
    setTimeout(() => {
      if (!G.resultOpen) return;
      dom.playAgainBtn.focus({ preventScroll: true });
    }, 650);
  }

  function startGame() {
    if (G.online && G.online.active && !G.online.initializing) {
      addToast('联机对局中不能重新开局', 'info', 1800);
      return;
    }
    if (G.mode === 'chase' && !(G.online && G.online.active)) {
      startChaseGame();
      return;
    }
    G.chase = null;
    dom.hud.classList.remove('is-chase');
    dom.chaseStatus.hidden = true;
    audio.init();
    closeHelp(true);
    closeArena(true);
    closeCodex(true);
    closeInspect(true);
    closeResult(true);
    closeQuitConfirm(true);
    closeAIPersona(true);
    closePersonalityPool(true);
    clearToasts();
    clearTimeout(G.bannerTimer);

    G.phase = 'intro';
    G.paused = false;
    G.helpOpen = false;
    G.arenaOpen = false;
    G.resultOpen = false;
    G.active = null;
    G.activeIndex = -1;
    G.turn = 0;
    if (G.online && G.online.active) {
      G.matchSize = Math.max(2, G.online.participantCoins ? G.online.participantCoins.length : 2);
      G.mode = G.online.mode || 'turn';
      G.participants = (G.online.participantCoins || G.online.participants || []).slice();
      G.playerId = G.online.localCoin;
    } else {
      G.matchSize = clamp(G.matchSize, 2, maxMatchSize());
      G.participants = pickParticipantIds();
    }
    G.alive = G.participants.length;
    G.introT = 0;
    G.aim.power = 0;
    G.aim.charging = false;
    G.aim.chargeT = 0;
    G.curveInput.left = false;
    G.curveInput.right = false;
    G.resolve = { elapsed: 0, still: 0, delay: 0 };
    G.ai = {
      plan: null,
      elapsed: 0,
      waiting: 0,
      planned: false,
      aimDuration: getAIDifficulty().aimDuration,
    };
    G.pending = null;
    G.playerOut = false;
    G.winnerId = null;
    G.volley = null;
    G.anchorBonus = null;
    if (G.online) {
      G.online.timer = null;
      G.online.skipSerial = 0;
      G.online.skipText = null;
      G.online.lastSkipSerial = 0;
    }
    G.slowmo = 0;
    G.timeScale = 1;
    G.combo = { count: 0, timer: 0, last: -10 };
    G.dangerNotified = false;
    G.panHintShown = false;
    G.zoomAdjusted = false;
    G.arena.shrink = 1;
    G.shrinkFlash = 0;
    updateArenaRadius();
    resetCamera(true);
    resetStats();
    clearEffects();
    G.coins = createCoins(false);
    G.alive = G.coins.length;
    assignAIPersonalities();
    resetMatchObstacles();
    arrangeRoster(G.participants);
    if (dom.roster) dom.roster.classList.toggle('is-volley', G.mode === 'volley');
    G.physicsAcc = 0;

    dom.menu.classList.add('is-hidden');
    dom.menu.setAttribute('aria-hidden', 'true');
    dom.menu.inert = true;
    dom.hud.classList.add('is-visible');
    dom.hud.setAttribute('aria-hidden', 'false');
    dom.hud.inert = false;
    syncGameExitButtons();
    dom.startBanner.classList.remove('is-visible');
    dom.roundFlash.classList.remove('is-flashing');
    void dom.roundFlash.offsetWidth;
    dom.roundFlash.classList.add('is-flashing');
    dom.comboBadge.classList.remove('is-visible');

    updateRoster();
    updateHUD(true);
    if (G.online && G.online.active) {
      showBanner('ONLINE', '联机对战', `${G.participants.length} 人 · ${G.mode === 'volley' ? '齐射' : '轮流'} · 房间 ${G.online.code}`, 1900);
    } else {
      const shrinkRule = G.arena.turnLimit > 0
        ? ` · 第 ${G.arena.turnLimit + 1} 回合起收缩 ${G.arena.shrinkRate}%`
        : '';
      const modeRule = G.mode === 'volley' ? '全体齐射' : '顺序随机 · 首发保护';
      showBanner(
        G.mode === 'volley' ? 'VOLLEY' : 'ROUND 01',
        G.mode === 'volley' ? '齐射' : '准备',
        `${G.matchSize} 枚硬币 · ${modeRule}${shrinkRule}`,
        1550,
      );
    }
    audio.stopCharge();
    audio.ui();
    addWave(0, 0, R * 0.8, 'rgba(80,231,212,0.22)', 1.1, 1.2);
  }

  function applySuddenDeath() {
    const limit = Math.round(Number(G.arena.turnLimit) || 0);
    if (limit <= 0 || G.turn <= limit) return;
    const rate = clamp(Math.round(Number(G.arena.shrinkRate) || 0) / 100, 0.02, 0.15);
    const nextShrink = Math.max(ARENA_MIN_SHRINK_FACTOR, G.arena.shrink * (1 - rate));
    if (nextShrink >= G.arena.shrink - 0.0001) return; // already at the floor

    G.arena.shrink = nextShrink;
    updateArenaRadius();
    pruneObstacles();
    G.shrinkFlash = 1;
    addShake(16);
    flashScreen('255, 154, 96', 0.055);
    addWave(0, 0, R * 0.86, 'rgba(255, 170, 100, 0.16)', 0.6, 1.7, false);
    audio.shrink();
    addToast(`第 ${G.turn} 回合 · 边界收缩 ${Math.round(rate * 100)}%`, 'info', 2700);
    checkBoundaries('shrink');
    clampCameraTarget();
    updateArenaHudLabel();
    updateHUD(true);
  }

  function beginNextRound() {
    if (G.phase === 'pending' || G.phase === 'over' || G.phase === 'menu') return;
    G.anchorBonus = null;
    G.coins.forEach((coin) => {
      coin.anchorHeld = false;
      coin.anchorAiTimer = 0;
    });
    if (G.mode === 'volley') beginVolleyRound();
    else beginTurn();
  }

  function beginTurn() {
    if (G.phase === 'pending' || G.phase === 'over' || G.phase === 'menu') return;
    let aliveCoins = G.coins.filter((c) => c.alive);
    if (aliveCoins.length <= 1) {
      const winner = aliveCoins[0] || null;
      G.winnerId = winner ? winner.id : null;
      if (winner && winner.id === G.playerId) scheduleResult('win', 0.65);
      else scheduleResult('defeat', 0.65);
      return;
    }

    G.turn += 1;
    applySuddenDeath();
    if (G.phase === 'pending' || G.phase === 'over') return;
    aliveCoins = G.coins.filter((c) => c.alive);
    if (aliveCoins.length <= 1) {
      const winner = aliveCoins[0] || null;
      G.winnerId = winner ? winner.id : null;
      if (winner && winner.id === G.playerId) scheduleResult('win', 0.65);
      else scheduleResult('defeat', 0.65);
      return;
    }

    let nextIndex = (G.activeIndex + 1) % G.coins.length;
    for (let i = 0; i < G.coins.length; i += 1) {
      if (G.coins[nextIndex].alive) break;
      nextIndex = (nextIndex + 1) % G.coins.length;
    }

    G.coins.forEach((c) => {
      c.active = false;
      c.spawn = 1;
    });
    G.activeIndex = nextIndex;
    G.active = G.coins[nextIndex];
    G.active.active = true;
    prepareEchoTurn(G.active);
    G.aim.power = 0;
    G.aim.chargeT = 0;
    G.aim.charging = false;
    const aiDifficulty = getAIDifficulty();
    G.ai = {
      plan: null,
      elapsed: 0,
      waiting: 0,
      planned: false,
      aimDuration: aiDifficulty.aimDuration,
    };
    if (G.active && G.active.personality && G.active.personality.id === 'lazy') {
      G.ai.waiting += 0.85;
    }
    G.resolve = { elapsed: 0, still: 0, delay: 0 };
    G.pending = null;
    G.dangerNotified = false;

    G.phase = G.active.id === G.playerId ? 'playerAim' : 'aiAim';
    if (G.online && G.online.active) {
      const controller = (G.online.controllers && G.online.controllers[G.active.id]) || 'ai';
      if (G.online.names) G.online.activeName = G.online.names[G.active.id] || G.active.name;
      G.online.activeType = controller;
      G.aim.angle = Math.atan2(-G.active.y, -G.active.x);
      if (controller === 'host') {
        G.phase = 'playerAim';
        updateAimFromPointer();
        dom.turnKicker.textContent = '联机 · 你的回合';
      } else if (controller === 'guest') {
        G.phase = 'onlineWait';
        dom.turnKicker.textContent = `联机 · 等待 ${G.online.activeName || '对手'}`;
      } else {
        G.phase = 'aiAim';
        dom.turnKicker.textContent = '联机 · AI 行动';
        G.ai.waiting = rand(aiDifficulty.waitMin, aiDifficulty.waitMax);
      }
      if (controller === 'host' || controller === 'guest') {
        startOnlineShotTimer('turn', G.active.id);
      } else {
        clearOnlineShotTimer();
      }
    } else if (G.active.id === G.playerId) {
      G.aim.angle = Math.atan2(-G.active.y, -G.active.x);
      updateAimFromPointer();
      dom.turnKicker.textContent = '你的回合';
    } else {
      G.aim.angle = Math.atan2(-G.active.y, -G.active.x);
      dom.turnKicker.textContent = '对手行动';
      G.ai.waiting = rand(aiDifficulty.waitMin, aiDifficulty.waitMax);
    }

    // When the user has zoomed in, bring the active coin into the centre
    // for the new turn, unless they have taken manual control of the camera.
    if (!G.camera.userPanned && G.zoomAdjusted && G.camera.tzoom > G.baseZoom * 1.06) {
      G.camera.tx = G.active.x;
      G.camera.ty = G.active.y;
      clampCameraTarget();
    }
    // Even after manual panning, never start a turn with the active coin
    // hidden behind the viewport edge or bottom HUD.
    ensureActiveVisible();

    updateRoster();
    updateHUD(true);
    if (G.turn === 1 && !(G.online && G.online.active)) {
      addToast(
        G.active.id === G.playerId ? '随机先手 · 你的回合' : `随机先手 · ${G.active.name}`,
        'info',
        2200,
      );
    }
    addWave(G.active.x, G.active.y, 64, rgba(G.active.color, 0.5), 0.42, 1.4);
    audio.turn();
  }

  function beginVolleyRound() {
    if (G.phase === 'pending' || G.phase === 'over' || G.phase === 'menu') return;
    let aliveCoins = G.coins.filter((c) => c.alive);
    if (aliveCoins.length <= 1) {
      const winner = aliveCoins[0] || null;
      G.winnerId = winner ? winner.id : null;
      if (winner && winner.id === G.playerId) scheduleResult('win', 0.65);
      else scheduleResult('defeat', 0.65);
      return;
    }

    G.turn += 1;
    applySuddenDeath();
    if (G.phase === 'pending' || G.phase === 'over') return;
    aliveCoins = G.coins.filter((c) => c.alive);
    if (aliveCoins.length <= 1) {
      const winner = aliveCoins[0] || null;
      G.winnerId = winner ? winner.id : null;
      if (winner && winner.id === G.playerId) scheduleResult('win', 0.65);
      else scheduleResult('defeat', 0.65);
      return;
    }

    const player = playerCoin();
    G.phase = 'volleyAim';
    G.pending = null;
    G.resolve = { elapsed: 0, still: 0, delay: 0 };
    G.ai = {
      plan: null,
      elapsed: 0,
      waiting: 0,
      planned: false,
      aimDuration: getAIDifficulty().aimDuration,
    };
    G.aim.charging = false;
    G.aim.power = 0;
    G.aim.chargeT = 0;
    G.pointer.down = false;
    G.dangerNotified = false;
    G.volley = {
      round: G.turn,
      alive: aliveCoins.length,
      locked: 0,
      skipped: 0,
      elapsed: 0,
      fireTimer: 0,
      firing: false,
      playerLocked: false,
    };

    G.active = player && player.alive ? player : null;
    G.activeIndex = G.active ? G.coins.indexOf(G.active) : -1;
    G.coins.forEach((coin) => {
      coin.active = coin === G.active;
      coin.locked = false;
      coin.volleySkipped = false;
      coin.volleyPlan = null;
      coin.volleyLockDelay = 0;
    });

    if (G.active) {
      G.aim.angle = Math.atan2(-G.active.y, -G.active.x);
      updateAimFromPointer();
    }

    const aiDifficulty = getAIDifficulty();
    let offset = 0;
    aliveCoins.forEach((coin) => {
      const controller = G.online && G.online.active
        ? (G.online.controllers[coin.id] || 'ai')
        : (coin.id === G.playerId ? 'host' : 'ai');
      if (controller !== 'ai') return;
      const plan = makeAIPlan(coin) || {
        angle: rand(0, TAU),
        power: rand(0.45, 0.85),
        target: null,
      };
      coin.volleyPlan = plan;
      coin.volleyLockDelay = rand(
        aiDifficulty.volleyLockMin || 0.8,
        aiDifficulty.volleyLockMax || 1.7,
      ) + offset * 0.05;
      offset += 1;
    });

    G.coins.forEach((coin) => prepareEchoTurn(coin));
    updateRoster();
    updateHUD(true);
    if (G.active) ensureActiveVisible();
    addWave(0, 0, R * 0.78, 'rgba(80,231,212,0.20)', 0.55, 1.4);
    audio.turn();
    if (G.online && G.online.active) startOnlineShotTimer('volley');
  }

  function updateVolleyAim(dt) {
    if (G.phase !== 'volleyAim' || !G.volley) return;
    G.volley.elapsed += dt;
    let changed = false;
    G.coins.forEach((coin) => {
      if (!coin.alive || coin.locked) return;
      const controller = G.online && G.online.active
        ? (G.online.controllers[coin.id] || 'ai')
        : (coin.id === G.playerId ? 'host' : 'ai');
      if (controller !== 'ai') return;
      if (G.volley.elapsed >= coin.volleyLockDelay) {
        coin.locked = true;
        G.volley.locked += 1;
        addWave(coin.x, coin.y, coin.radius + 14, rgba(coin.color, 0.42), 0.28, 1.2, false);
        changed = true;
      }
    });
    if (changed) {
      updateRoster();
      updateHUD(true);
    }
    maybeStartVolleyFire();
    if (G.phase === 'volleyAim' && G.volley.firing) {
      G.volley.fireTimer -= dt;
      if (G.volley.fireTimer <= 0) fireVolley();
    }
  }

  function maybeStartVolleyFire() {
    if (!G.volley || G.phase !== 'volleyAim' || G.volley.firing) return;
    if (G.volley.locked < G.volley.alive) return;
    const singlePlayer = !(G.online && G.online.active);
    G.volley.firing = true;
    G.volley.fireTimer = singlePlayer ? 0 : 0.55;
    clearOnlineShotTimer();
    audio.ping(920, 0.1, 0.025, 'sine', 0, 0.9);
    updateHUD(true);
  }

  function lockPlayerVolley() {
    if (G.phase !== 'volleyAim' || !G.volley || G.volley.firing || G.playerOut) return;
    const player = playerCoin();
    if (!player || !player.alive || player.locked) return;
    const power = clamp(G.aim.power, 0, 1);
    const lockedPower = Math.max(0.04, power);
    player.volleyPlan = { angle: G.aim.angle, power: lockedPower, target: null };
    player.locked = true;
    player.volleySkipped = false;
    G.volley.playerLocked = true;
    G.volley.locked += 1;
    G.aim.charging = false;
    G.pointer.down = false;
    G.aim.power = lockedPower;
    audio.stopCharge();
    addWave(player.x, player.y, player.radius + 16, rgba(player.color, 0.5), 0.3, 1.2, false);
    // Single-player volley resolves AI instantly so releasing the mouse never
    // stalls into an avoidable pre-fire wait.
    if (!(G.online && G.online.active)) {
      G.coins.forEach((coin) => {
        if (!coin.alive || coin.locked) return;
        if (!coin.volleyPlan) {
          coin.volleyPlan = makeAIPlan(coin) || {
            angle: rand(0, TAU),
            power: rand(0.45, 0.85),
            target: null,
          };
        }
        coin.locked = true;
        G.volley.locked += 1;
      });
    }
    updateRoster();
    updateHUD(true);
    maybeStartVolleyFire();
  }

  function coinControllerFor(coin) {
    if (!coin) return 'ai';
    if (G.online && G.online.active) {
      return (G.online.controllers && G.online.controllers[coin.id]) || 'ai';
    }
    return coin.id === G.playerId ? 'player' : 'ai';
  }

  function clearEchoMarkers() {
    G.coins.forEach((coin) => {
      coin.marker = null;
      coin.aiRecallTimer = 0;
      coin.aiWillRecall = false;
    });
  }

  function placeEchoMarker(coin, silent = false) {
    if (!coin || coin.def.id !== 'echo' || !coin.alive) return false;
    if (!coin.skillReady || coin.skillCooldown > 0 || coin.marker) return false;
    coin.marker = { x: coin.x, y: coin.y, born: G.time };
    if (!silent) {
      audio.echoMark();
      addWave(coin.x, coin.y, coin.radius + 20, rgba(coin.def.color, 0.45), 0.45, 1.5, false);
      addFloatingText(coin.x, coin.y - coin.radius - 16, '留标', coin.def.faceLight, 10, 0.9);
      updateHUD(true);
      updateRoster();
    }
    return true;
  }

  function prepareEchoTurn(coin) {
    if (!coin || !coin.alive) return;
    if (coin.def.id === 'anchor') {
      const wasCooling = coin.skillCooldown > 0;
      if (wasCooling) coin.skillCooldown = Math.max(0, coin.skillCooldown - 1);
      coin.skillReady = coin.skillCooldown <= 0;
      return;
    }
    if (coin.def.id !== 'echo') return;
    const hadMarker = !!coin.marker;
    const wasCooling = coin.skillCooldown > 0;
    if (wasCooling) coin.skillCooldown = Math.max(0, coin.skillCooldown - 1);
    coin.skillReady = !wasCooling;
    coin.aiRecallTimer = 0;
    if (hadMarker) {
      if (coin.skillCooldown > 0) coin.marker = null;
      if (coinControllerFor(coin) === 'ai') coin.aiWillRecall = true;
      return;
    }
    coin.aiWillRecall = false;
    if (coinControllerFor(coin) === 'ai' && coin.skillReady) {
      const blackdog = coin.personality && coin.personality.id === 'blackdog';
      coin.aiWillRecall = blackdog || Math.random() < 0.7;
      if (coin.aiWillRecall) placeEchoMarker(coin, true);
    }
  }

  function recallEchoCoin(coin, fromAI = false) {
    if (!coin || coin.def.id !== 'echo' || !coin.alive || !coin.marker) return false;
    if (!coin.skillReady || coin.skillCooldown > 0) return false;
    const marker = coin.marker;
    const oldX = coin.x;
    const oldY = coin.y;
    coin.x = marker.x;
    coin.y = marker.y;
    coin.prevX = marker.x;
    coin.prevY = marker.y;
    coin.trail = [];
    coin.trailT = 0;
    coin.marker = null;
    coin.skillCooldown = 3;
    coin.skillReady = false;
    coin.aiRecallTimer = 0;
    coin.flash = 1;
    coin.squash = 0.35;
    addWave(oldX, oldY, coin.radius + 24, rgba(coin.def.color, 0.45), 0.45, 1.8, false);
    addWave(coin.x, coin.y, coin.radius + 30, rgba(coin.def.faceLight, 0.65), 0.55, 2.2, false);
    addSparkBurstAtCoin(coin, rand(0, TAU), 14, 160);
    addFloatingText(coin.x, coin.y - coin.radius - 20, '折返', coin.def.faceLight, 13, 1.1);
    addShake(3);
    flashScreen(coin.def.rgb, 0.018);
    audio.echoRecall();
    if (!fromAI) addToast('折返 · 回到标记点', 'info', 1500);
    updateHUD(true);
    updateRoster();
    return true;
  }

  function echoEnemyWindow(coin) {
    if (!coin || !coin.marker) return false;
    if (G.mode === 'volley') {
      return G.phase === 'resolve' && !!G.volley;
    }
    if (!G.active || G.active === coin) return false;
    return G.phase === 'aiAim'
      || G.phase === 'playerAim'
      || G.phase === 'onlineWait'
      || G.phase === 'resolve';
  }

  function echoPlayerAction(coin) {
    if (!coin || coin.def.id !== 'echo' || !coin.alive) return null;
    if (!coin.skillReady || coin.skillCooldown > 0) return null;
    if ((G.phase === 'playerAim' || G.phase === 'volleyAim')
      && G.active === coin && canPlayerAim() && !coin.locked && !coin.marker) {
      return 'mark';
    }
    if (coin.marker && coin.hasFired && echoEnemyWindow(coin)) {
      return 'recall';
    }
    return null;
  }

  function performEchoAction(coin, action) {
    if (action === 'mark') return placeEchoMarker(coin);
    if (action === 'recall') return recallEchoCoin(coin);
    return false;
  }

  function useEchoSkill() {
    const coin = playerCoin();
    if (!coin || coin.def.id !== 'echo' || !coin.alive) return;
    const action = echoPlayerAction(coin);
    if (!action) return;
    if (G.online && G.online.active && G.online.role === 'guest') {
      sendOnlineAction('skill', { action, coin: coin.id });
      return;
    }
    performEchoAction(coin, action);
  }

  function applyRemoteEcho(payload) {
    if (!G.online || G.online.role !== 'host' || !G.online.active) return;
    const coin = G.coins.find((c) => c.id === payload.coin);
    if (!coin || coin.def.id !== 'echo' || !coin.alive) return;
    const slots = G.online.room && G.online.room.slots;
    if (slots && (!slots[payload.slot] || slots[payload.slot].coin !== coin.id)) return;
    if ((G.online.controllers && G.online.controllers[coin.id]) !== 'guest') return;
    if (payload.action === 'mark') {
      if (G.phase !== 'volleyAim' && G.phase !== 'onlineWait') return;
      if (G.phase === 'onlineWait' && G.active !== coin) return;
      if (G.phase === 'volleyAim' && coin.locked) return;
      placeEchoMarker(coin);
    } else if (payload.action === 'recall') {
      if (!coin.marker || !coin.hasFired) return;
      if (!echoEnemyWindow(coin)) return;
      recallEchoCoin(coin);
    }
  }

  function canAnchorSkill(coin) {
    if (!coin || !coin.alive || coin.def.id !== 'anchor') return false;
    if (G.phase !== 'resolve' || G.anchorBonus || G.pending) return false;
    if (!coin.skillReady || coin.skillCooldown > 0) return false;
    return Math.hypot(coin.vx, coin.vy) > 18;
  }

  function setupAnchorBonusAim(coin) {
    const online = !!(G.online && G.online.active);
    const controller = coinControllerFor(coin);
    G.coins.forEach((item) => { item.active = false; });
    G.active = coin;
    coin.active = true;
    coin.anchorHeld = true;
    coin.anchorX = coin.x;
    coin.anchorY = coin.y;
    G.aim.angle = Math.atan2(-coin.y, -coin.x);
    G.aim.power = 0;
    G.aim.chargeT = 0;
    G.aim.charging = false;
    G.pointer.down = false;
    G.pending = null;
    G.dangerNotified = false;
    clearOnlineShotTimer();
    if (controller === 'player' || (online && controller === 'host')) {
      G.phase = 'playerAim';
      if (online) startOnlineShotTimer('turn', coin.id);
    } else if (online && controller === 'guest') {
      G.phase = 'onlineWait';
      G.online.activeName = (G.online.names && G.online.names[coin.id]) || coin.name;
      G.online.activeType = 'guest';
      startOnlineShotTimer('turn', coin.id);
    } else {
      G.phase = 'aiAim';
      G.ai = {
        plan: null,
        elapsed: 0,
        waiting: 0.35,
        planned: false,
        aimDuration: getAIDifficulty().aimDuration,
      };
      G.ai.waiting = coin.personality && coin.personality.id === 'blackdog' ? 0.18 : 0.42;
    }
    ensureActiveVisible();
    updateHUD(true);
    updateRoster();
  }

  function useAnchorSkill(coin, fromRemote = false) {
    if (!canAnchorSkill(coin)) return false;
    if (!fromRemote && G.online && G.online.active && G.online.role === 'guest') {
      if (G.online.anchorSent) return true;
      G.online.anchorSent = true;
      sendOnlineAction('skill', { action: 'anchor', coin: coin.id });
      return true;
    }
    coin.vx = 0;
    coin.vy = 0;
    coin.spin = 0;
    coin.speed = 0;
    coin.anchorHeld = true;
    coin.anchorX = coin.x;
    coin.anchorY = coin.y;
    coin.skillCooldown = 4;
    coin.skillReady = false;
    coin.anchorAiTimer = 0;
    G.anchorSerial += 1;
    G.anchorBonus = {
      coinId: coin.id,
      serial: G.anchorSerial,
      aiming: true,
    };
    audio.stopCharge();
    audio.ping(520, 0.18, 0.045, 'triangle', 0, 0.62);
    addWave(coin.x, coin.y, coin.radius * 1.7, 'rgba(155,215,255,0.7)', 0.45, 2.6, false);
    addSparks(coin.x, coin.y, 24, ['#9bd7ff', '#e7f8ff', '#5c9fc4'], 260, TAU);
    addFloatingText(coin.x, coin.y - coin.radius - 18, '急停', '#cfefff', 14, 1.0);
    addShake(5);
    setupAnchorBonusAim(coin);
    return true;
  }

  function applyRemoteAnchor(payload) {
    if (!G.online || G.online.role !== 'host' || !G.online.active) return;
    const coin = G.coins.find((item) => item.id === payload.coin);
    if (!coin || coin.def.id !== 'anchor' || !coin.alive) return;
    const slots = G.online.room && G.online.room.slots;
    if (slots && Number.isInteger(Number(payload.slot))) {
      const slot = slots[Number(payload.slot)];
      if (!slot || slot.coin !== coin.id) return;
    }
    if ((G.online.controllers && G.online.controllers[coin.id]) !== 'guest') return;
    useAnchorSkill(coin, true);
  }

  function updateAnchorAI(dt) {
    if (G.phase !== 'resolve' || G.anchorBonus || G.pending) return;
    for (const coin of G.coins) {
      if (coin.def.id !== 'anchor' || !coin.alive) continue;
      if (coinControllerFor(coin) !== 'ai') continue;
      if (!coin.skillReady || coin.skillCooldown > 0) continue;
      if (Math.hypot(coin.vx, coin.vy) < 40) continue;
      coin.anchorAiTimer += dt;
      const boundary = distanceToArenaOpenBoundary(coin.x, coin.y);
      const blackdog = coin.personality && coin.personality.id === 'blackdog';
      const threshold = boundary < R * 0.18 ? 0.12 : (blackdog ? 0.16 : 0.55);
      if (coin.anchorAiTimer >= threshold) {
        useAnchorSkill(coin, true);
        break;
      }
    }
  }

  function updateEchoAI(dt) {
    G.coins.forEach((coin) => {
      if (coin.def.id !== 'echo' || !coin.alive || !coin.marker) return;
      if (coinControllerFor(coin) !== 'ai' || !coin.aiWillRecall) return;
      if (!coin.skillReady || coin.skillCooldown > 0) return;
      if (!echoEnemyWindow(coin)) return;
      if (coin.aiRecallTimer <= 0) {
        const blackdog = coin.personality && coin.personality.id === 'blackdog';
        coin.aiRecallTimer = blackdog ? rand(0.12, 0.26) : rand(0.28, 0.82);
      }
      coin.aiRecallTimer -= dt;
      if (coin.aiRecallTimer <= 0) {
        coin.aiRecallTimer = 0;
        recallEchoCoin(coin, true);
      }
    });
  }

  function launchVolleyCoin(coin, angle, power) {
    coin.hasFired = true;
    if (coin.def.id === 'echo' && coin.marker && coin.aiWillRecall
      && coinControllerFor(coin) === 'ai') {
      coin.aiRecallTimer = rand(0.24, 0.9);
    }
    const p = clamp(power, 0, 1);
    const speed = launchSpeedForPower(coin, p);
    coin.vx = Math.cos(angle) * speed;
    coin.vy = Math.sin(angle) * speed;
    coin.spin = rand(-6, 6) + (Math.random() > 0.5 ? 2.2 : -2.2);
    coin.trail = [];
    coin.trailT = 0;
    coin.lastHitBy = null;
    coin.chainUsed = false;
    coin.frictionScale = shotFrictionScale(coin, p);
    coin.skillBurst = coin.def.id === 'amber' && p >= 0.9;
    G.stats.shots += 1;
    G.stats.topSpeed = Math.max(G.stats.topSpeed, speed);

    let trigger = '';
    if (coin.def.id === 'gold' && p >= 0.75) trigger = '熔芯 +8%';
    else if (coin.def.id === 'azure' && p >= 0.5 && p <= 0.78) trigger = '定轨 +10%';
    else if (coin.def.id === 'amber' && p >= 0.9) trigger = '孤注 +16%';
    if (trigger) {
      addFloatingText(coin.x, coin.y - coin.radius - 16, trigger, coin.def.faceLight, 10, 0.9);
    }
    addSparkBurstAtCoin(coin, -angle, 5 + Math.round(p * 6), 170 + p * 250);
    addPuff(
      coin.x - Math.cos(angle) * coin.radius,
      coin.y - Math.sin(angle) * coin.radius,
      4 + Math.round(p * 6),
      rgba(coin.color, 0.12),
      70 + p * 60,
    );
    addWave(coin.x, coin.y, 38 + p * 24, rgba(coin.color, 0.5), 0.3, 1.15, false);
  }

  function fireVolley() {
    if (G.phase !== 'volleyAim' || !G.volley) return;
    clearOnlineShotTimer();
    const aliveCoins = G.coins.filter((c) => c.alive);
    let count = 0;
    let totalPower = 0;
    aliveCoins.forEach((coin) => {
      const plan = coin.volleyPlan;
      if (!plan) return;
      launchVolleyCoin(coin, plan.angle, plan.power);
      count += 1;
      totalPower += plan.power;
    });
    G.volley.firing = false;
    G.phase = 'resolve';
    G.resolve = { elapsed: 0, still: 0, delay: 0.28 };
    G.aim.charging = false;
    G.aim.power = 0;
    G.aim.chargeT = 0;
    G.pointer.down = false;
    G.ai.plan = null;
    G.slowmo = Math.max(G.slowmo, 0.06);
    audio.stopCharge();
    audio.volley(totalPower / Math.max(1, count), count);
    addShake(9 + count * 1.8);
    flashScreen('255, 209, 102', 0.035);
    addWave(0, 0, R * 0.9, 'rgba(255,209,102,0.18)', 0.6, 1.8, false);
    addToast(`齐射 · ${count} 枚硬币同时发射`, 'info', 1800);
    updateRoster();
    updateHUD(true);
  }

  function fireCoin(coin, angle, power) {
    if (!coin || !coin.alive) return;
    if (coin.anchorHeld) {
      coin.anchorHeld = false;
      if (G.anchorBonus && G.anchorBonus.coinId === coin.id) {
        G.anchorBonus.aiming = false;
        G.anchorBonus.fired = true;
      }
    }
    if (G.online && G.online.active && G.online.timer && G.online.timer.mode === 'turn') {
      clearOnlineShotTimer();
    }
    coin.hasFired = true;
    if (coin.def.id === 'echo' && coin.marker && coin.aiWillRecall
      && coinControllerFor(coin) === 'ai') {
      coin.aiRecallTimer = rand(0.24, 0.86);
    }
    const p = clamp(power, 0, 1);
    const speed = launchSpeedForPower(coin, p);
    coin.vx = Math.cos(angle) * speed;
    coin.vy = Math.sin(angle) * speed;
    coin.spin = rand(-6, 6) + (Math.random() > 0.5 ? 2.2 : -2.2);
    coin.trail = [];
    coin.trailT = 0;
    coin.lastHitBy = null;
    coin.chainUsed = false;
    coin.frictionScale = shotFrictionScale(coin, p);
    coin.skillBurst = coin.def.id === 'amber' && p >= 0.9;
    G.stats.shots += 1;
    G.stats.topSpeed = Math.max(G.stats.topSpeed, speed);
    G.aim.charging = false;
    G.aim.power = 0;
    G.aim.chargeT = 0;

    let trigger = '';
    if (coin.def.id === 'gold' && p >= 0.75) trigger = '熔芯 +8%';
    else if (coin.def.id === 'azure' && p >= 0.5 && p <= 0.78) trigger = '定轨 +10%';
    else if (coin.def.id === 'amber' && p >= 0.9) trigger = '孤注 +16%';
    if (trigger) {
      addFloatingText(coin.x, coin.y - coin.radius - 16, trigger, coin.def.faceLight, 11, 0.95);
      addWave(coin.x, coin.y, 42, rgba(coin.color, 0.55), 0.3, 1.2);
    }

    G.phase = 'resolve';
    G.resolve = { elapsed: 0, still: 0, delay: 0 };
    G.ai.plan = null;
    audio.stopCharge();
    audio.launch(p);
    addShake(1.3 + p * 3.4);
    addSparkBurstAtCoin(coin, -angle, 5 + Math.round(p * 7), 190 + p * 280);
    addPuff(coin.x - Math.cos(angle) * coin.radius, coin.y - Math.sin(angle) * coin.radius, 5 + Math.round(p * 8), rgba(coin.color, 0.12), 80 + p * 70);
    addWave(coin.x, coin.y, 44 + p * 28, rgba(coin.color, 0.55), 0.32, 1.2);
    if (p > 0.9) flashScreen(coin.rgb, 0.032);
    updateHUD(true);
  }

  function scheduleResult(result, delay = 1.55) {
    if (G.pending || G.phase === 'over') return;
    clearOnlineShotTimer();
    G.pending = { result, timer: delay };
    G.phase = 'pending';
    G.aim.charging = false;
    G.aim.power = 0;
    audio.stopCharge();
    updateHUD(true);
  }

  function finishGame(result) {
    if (G.phase === 'over' && G.resultOpen) return;
    clearOnlineShotTimer();
    G.phase = 'over';
    G.resultOpen = true;
    G.stats.matchTime = G.stats.elapsed;
    clearPanKeys();
    G.aim.charging = false;
    G.aim.power = 0;
    audio.stopCharge();
    const win = result === 'win';
    const playerDef = getPlayerDef();
    const winnerDef = G.winnerId
      ? (G.coins.find((coin) => coin.id === G.winnerId)?.def || participantDef(G.winnerId))
      : null;
    const spectated = !win && G.playerOut && winnerDef;
    dom.result.style.setProperty('--result-rgb', playerDef.rgb);
    dom.result.style.setProperty('--result-color', playerDef.color);
    dom.result.style.setProperty('--result-light', playerDef.faceLight);
    dom.result.style.setProperty('--result-dark', playerDef.faceDark);
    dom.result.classList.toggle('is-defeat', !win);
    dom.resultKicker.textContent = win || spectated ? 'MATCH COMPLETE' : 'MATCH LOST';
    dom.resultTime.textContent = formatTime(G.stats.matchTime);
    dom.resultEyebrow.textContent = win
      ? 'LAST COIN STANDING'
      : (spectated ? `CHAMPION · ${winnerDef.name}` : 'OUTSIDE THE EDGE');
    dom.resultTitle.textContent = win ? '胜利' : '出局';
    dom.resultSub.textContent = win
      ? (G.stats.kos > 0
        ? `桌面归于寂静。你的${playerDef.name}亲手送走了 ${G.stats.kos} 枚硬币。`
        : `桌面归于寂静。你的${playerDef.name}是最后一枚还留在边界内的硬币。`)
      : (spectated
        ? `你已出局。${winnerDef.name}成为最后留在场上的硬币。`
        : `你的${playerDef.name}坠入了边界之外。下一次，把角度算得更准一点。`);
    setResultStatLabels(['击飞出局', '碰撞次数', '最高时速', '总用时']);
    dom.statKOs.textContent = String(G.stats.kos);
    dom.statHits.textContent = String(G.stats.hits);
    dom.statSpeed.innerHTML = `${Math.round(G.stats.topSpeed * 0.1)}<small> km/h</small>`;
    dom.statTime.textContent = formatTime(G.stats.matchTime);
    if (G.online && G.online.active) {
      const host = G.online.role === 'host';
      const label = dom.playAgainBtn.querySelector('span');
      if (label) label.textContent = host ? '再来一局' : '等待房主重开';
      dom.playAgainBtn.disabled = !host;
      dom.returnRoomBtn.hidden = false;
      dom.returnRoomBtn.textContent = '返回房间';
      dom.backToMenuBtn.textContent = '离开房间';
      if (host && !G.online.resultSent) {
        G.online.resultSent = true;
        sendOnlineAction('result', {
          result,
          winnerId: G.winnerId,
          stats: { ...G.stats },
        });
        sendOnlineAction('reset-room', {
          arena: onlineArenaConfig(),
          mode: G.online.mode,
        });
        if (G.online.room) G.online.room.phase = 'result';
        stopOnlineSnapshots();
      }
    } else {
      const label = dom.playAgainBtn.querySelector('span');
      if (label) label.textContent = '再来一局';
      dom.playAgainBtn.disabled = false;
      dom.returnRoomBtn.hidden = true;
      dom.backToMenuBtn.textContent = '返回主菜单';
    }
    dom.result.classList.add('is-open');
    dom.result.setAttribute('aria-hidden', 'false');
    dom.hud.inert = true;
    syncGameExitButtons();
    updateRoster();
    updateHUD(true);
    if (win) audio.win();
    else audio.lose();
    setTimeout(() => {
      if (!G.resultOpen) return;
      const focusTarget = (!G.online || G.online.role === 'guest') && !dom.returnRoomBtn.hidden
        ? dom.returnRoomBtn
        : dom.playAgainBtn;
      focusTarget.focus({ preventScroll: true });
    }, 650);
  }

  function closeResult(immediate = false) {
    G.resultOpen = false;
    dom.result.classList.remove('is-open');
    dom.result.setAttribute('aria-hidden', 'true');
    if (immediate) dom.result.classList.remove('is-defeat');
  }

  function returnToMenu() {
    if (G.online) shutdownOnlineSession(true);
    closeHelp(true);
    closeArena(true);
    closeCodex(true);
    closeInspect(true);
    closeResult(true);
    closeQuitConfirm(true);
    closeAIPersona(true);
    closePersonalityPool(true);
    clearToasts();
    clearTimeout(G.bannerTimer);
    G.phase = 'menu';
    G.paused = false;
    G.resultOpen = false;
    G.helpOpen = false;
    G.arenaOpen = false;
    G.codexOpen = false;
    G.inspectOpen = false;
    G.pending = null;
    G.playerOut = false;
    G.winnerId = null;
    G.volley = null;
    G.anchorBonus = null;
    G.chase = null;
    G.obstacles = [];
    G.arenaObstaclePreview = null;
    G.active = null;
    G.activeIndex = -1;
    G.aim.charging = false;
    G.aim.power = 0;
    G.aim.chargeT = 0;
    G.slowmo = 0;
    G.timeScale = 1;
    G.arena.shrink = 1;
    G.shrinkFlash = 0;
    updateArenaRadius();
    G.participants = [];
    G.coins = createCoins(true);
    G.alive = G.coins.length;
    clearEffects();
    resetCamera(false);
    G.zoomAdjusted = false;
    dom.hud.classList.remove('is-visible');
    dom.hud.classList.remove('is-chase');
    dom.chaseStatus.hidden = true;
    dom.hud.setAttribute('aria-hidden', 'true');
    dom.hud.inert = true;
    dom.menu.classList.remove('is-hidden');
    dom.menu.setAttribute('aria-hidden', 'false');
    dom.menu.inert = false;
    if (dom.onlineExitBtn) dom.onlineExitBtn.hidden = true;
    syncGameExitButtons();
    dom.startBanner.classList.remove('is-visible');
    dom.comboBadge.classList.remove('is-visible');
    audio.stopCharge();
    updateRoster();
    updateHUD(true);
    updateZoomLabel();
  }

  /* =========================================================
     UI / HUD
     ========================================================= */
  function showBanner(kicker, title, subtitle, duration = 1200) {
    dom.startBanner.querySelector('.banner-kicker').textContent = kicker;
    dom.startBanner.querySelector('strong').textContent = title;
    dom.startBanner.querySelector('small').textContent = subtitle;
    dom.startBanner.classList.add('is-visible');
    clearTimeout(G.bannerTimer);
    G.bannerTimer = setTimeout(() => {
      dom.startBanner.classList.remove('is-visible');
    }, duration);
  }

  function addToast(text, type = 'info', duration = 2300) {
    if (!dom.toastLayer) return;
    const el = document.createElement('div');
    el.className = `toast ${type === 'out' ? 'is-out' : ''}`;
    el.textContent = text;
    dom.toastLayer.appendChild(el);
    while (dom.toastLayer.children.length > 3) {
      dom.toastLayer.firstElementChild.remove();
    }
    setTimeout(() => {
      el.classList.add('is-gone');
      setTimeout(() => el.remove(), 420);
    }, duration);
  }

  function clearToasts() {
    dom.toastLayer.innerHTML = '';
  }

  function applyRosterVisibility() {
    if (!dom.roster) return;
    dom.roster.classList.toggle('is-user-hidden', !!G.rosterHidden);
    const showRestore = !!G.rosterHidden
      && G.phase !== 'menu'
      && G.phase !== 'over'
      && !G.chase
      && !G.resultOpen;
    if (dom.rosterShowBtn) dom.rosterShowBtn.hidden = !showRestore;
    if (dom.rosterShowCount) dom.rosterShowCount.textContent = `${G.alive}`;
  }

  function setRosterHidden(hidden) {
    G.rosterHidden = !!hidden;
    safeStorageSet('edgecoin.rosterHidden', G.rosterHidden ? '1' : '0');
    applyRosterVisibility();
    audio.init();
    audio.ui();
  }

  function updateRoster() {
    G.alive = G.coins.filter((c) => c.alive).length;
    dom.rosterCount.textContent = `${G.alive} / ${G.coins.length}`;
    if (dom.rosterShowCount) dom.rosterShowCount.textContent = `${G.alive}`;
    G.coins.forEach((coin) => {
      const el = rosterEls[coin.id];
      if (!el) return;
      const volleyMode = G.mode === 'volley';
      const protectedCoin = isFirstShotProtected(coin);
      el.row.classList.toggle('is-out', !coin.alive);
      el.row.classList.toggle('is-player', isPlayerCoin(coin));
      el.row.classList.toggle('is-protected', protectedCoin);
      el.row.classList.toggle(
        'is-active',
        !volleyMode && !!coin.alive && G.active === coin && G.phase !== 'menu' && G.phase !== 'over',
      );
      el.row.classList.toggle(
        'is-locked',
        volleyMode && !!coin.alive && !!coin.locked && G.phase === 'volleyAim',
      );
      let status = '待命';
      if (!coin.alive) status = '出局';
      else if (volleyMode && G.phase === 'volleyAim') {
        if (coin.locked) status = coin.volleySkipped ? '超时' : '已锁定';
        else if (isPlayerCoin(coin)) status = '瞄准中';
        else status = '准备中';
      } else if (volleyMode && G.phase === 'resolve') {
        status = '滑行中';
      } else if (volleyMode && G.phase === 'pending') {
        status = '结算中';
      } else if (G.active === coin) {
        if (G.phase === 'playerAim') status = '你的回合';
        else if (G.phase === 'aiAim') status = '瞄准中';
        else if (G.phase === 'resolve') status = '滑行中';
        else if (G.phase === 'pending') status = '结算中';
        else status = '行动';
      } else if (coin.def.id === 'echo' && (!coin.skillReady || coin.skillCooldown > 0)) {
        status = coin.skillCooldown > 0 ? `冷却 ${coin.skillCooldown}` : '冷却中';
      } else if (protectedCoin) {
        status = '首发保护';
      } else if (coin.danger > 0.72) {
        status = '危险';
      } else if (isPlayerCoin(coin)) {
        status = '你的硬币';
      }
      el.status.textContent = status;
    });
    applyRosterVisibility();
  }

  function getPlayerDef() {
    return participantDef(G.playerId) || DEF_BY_ID.gold;
  }

  function renderCodexList() {
    if (!dom.codexList) return;
    dom.codexList.innerHTML = '';
    COIN_DEFS.forEach((def) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'codex-item';
      btn.dataset.coin = def.id;
      btn.setAttribute('role', 'option');
      btn.style.setProperty('--coin-color', def.color);
      btn.style.setProperty('--coin-rgb', def.rgb);
      btn.innerHTML = `
        <span class="codex-item-orb" aria-hidden="true">${def.glyph}</span>
        <span class="codex-item-name"><strong>${def.name}</strong><small>${def.role}</small></span>
        <span class="codex-item-skill">${def.skill.name}</span>
      `;
      btn.addEventListener('click', () => {
        G.codexPreviewId = def.id;
        audio.init();
        audio.ui();
        updateCodexDetail(def.id);
      });
      dom.codexList.appendChild(btn);
    });
  }

  function updateCodexDetail(id) {
    const def = DEF_BY_ID[id] || getPlayerDef();
    if (!dom.codexName) return;
    dom.codexOrb.style.setProperty('--coin-color', def.color);
    dom.codexOrb.style.setProperty('--coin-rgb', def.rgb);
    dom.codexGlyph.textContent = def.glyph;
    dom.codexRole.textContent = `${def.role} · ${def.roleEn}`;
    dom.codexName.textContent = def.name;
    dom.codexTagline.textContent = `${def.skill.short}。`;
    dom.codexSkillName.textContent = def.skill.name;
    dom.codexSkillTag.textContent = def.skill.tag;
    dom.codexSkillDesc.textContent = def.skill.desc;
    dom.codexMass.textContent = def.mass.toFixed(2);
    dom.codexSpeed.textContent = String(def.launchMax);
    dom.codexRoleShort.textContent = def.role;
    dom.codexTip.textContent = def.skill.tip;
    dom.codexSelectBtn.textContent = `选择 ${def.name}`;
    dom.codexSelectBtn.setAttribute('aria-label', `选择${def.name}作为你的硬币`);
    Array.from(dom.codexList.querySelectorAll('.codex-item')).forEach((btn) => {
      const preview = btn.dataset.coin === G.codexPreviewId;
      const current = btn.dataset.coin === G.playerId;
      btn.classList.toggle('is-preview', preview);
      btn.classList.toggle('is-current', current);
      btn.setAttribute('aria-selected', String(preview));
    });
  }

  function maxMatchSize() {
    if (G.online && G.online.active) return 8;
    return G.mode === 'volley' ? 24 : 8;
  }

  function applyMatchSizeUI() {
    const maxSize = maxMatchSize();
    dom.matchSizeButtons.forEach((btn) => {
      const active = Number(btn.dataset.size) === G.matchSize;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    if (dom.matchSizeCapLabel) {
      dom.matchSizeCapLabel.textContent = maxSize === 24 ? '2 – 24 COINS' : '2 – 8 COINS';
    }
    if (dom.matchSizeRangeBlock) dom.matchSizeRangeBlock.hidden = maxSize !== 24;
    if (dom.matchSizeRange) {
      dom.matchSizeRange.max = String(maxSize);
      dom.matchSizeRange.value = String(G.matchSize);
    }
    if (dom.matchSizeRangeValue) dom.matchSizeRangeValue.textContent = String(G.matchSize);
    if (dom.matchSizeNote) {
      dom.matchSizeNote.textContent = G.mode === 'chase'
        ? `${G.matchSize - 1} 名追兵 · 你 + ${G.matchSize - 1} AI`
        : `${G.matchSize} 枚硬币 · 你 + ${G.matchSize - 1} AI`;
    }
  }

  function applyChaseHpUI() {
    if (dom.chaseHpBlock) dom.chaseHpBlock.hidden = G.mode !== 'chase';
    if (dom.chaseHpButtons) {
      dom.chaseHpButtons.forEach((btn) => {
        const active = Number(btn.dataset.hp) === G.chaseHp;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', String(active));
      });
    }
  }

  function applyModeUI() {
    G.matchSize = clamp(G.matchSize, 2, maxMatchSize());
    dom.modeButtons.forEach((btn) => {
      const active = btn.dataset.mode === G.mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    if (dom.modeNote) {
      dom.modeNote.textContent = (GAME_MODES[G.mode] || GAME_MODES.turn).note;
    }
    applyChaseHpUI();
    applyMatchSizeUI();
    if (dom.ruleRows && dom.ruleRows.length >= 3) {
      if (G.mode === 'chase') {
        dom.ruleRows[0].innerHTML = '用鼠标瞄准、蓄力弹射，在巨大的圆形迷宫中<strong>找到出口</strong>。';
        dom.ruleRows[1].innerHTML = '弹射 3 次后追兵苏醒；滑行时停火，<strong>每次停稳后齐射一次</strong>。';
        dom.ruleRows[2].innerHTML = '被撞损失 1 点生命，追兵会被<strong>传送到迷宫外围</strong>；生命归零则失败。';
      } else {
        dom.ruleRows[0].innerHTML = '2–8 枚硬币可轮流出手；齐射支持 2–24 枚。<strong>中心越过边界即出局</strong>，没有第二次机会。';
        dom.ruleRows[1].innerHTML = '金属碰撞会传递动量。每枚硬币都有专属能力，<strong>角度与技能时机同样重要</strong>。';
        dom.ruleRows[2].innerHTML = '活到最后即可获胜。高速撞击会触发火花、冲击波与短暂慢镜头。';
      }
    }
  }

  function selectMode(mode) {
    if (!GAME_MODES[mode] || mode === G.mode) return;
    audio.init();
    audio.ui();
    G.mode = mode;
    safeStorageSet('edgecoin.mode', mode);
    applyModeUI();
    updateHUD(true);
  }

  function selectChaseHp(hp) {
    const next = clamp(Math.round(Number(hp) || 3), 1, 5);
    if (next === G.chaseHp) return;
    audio.init();
    audio.ui();
    G.chaseHp = next;
    safeStorageSet('edgecoin.chaseHp', String(next));
    applyChaseHpUI();
  }

  function selectMatchSize(size) {
    const next = clamp(Math.round(Number(size) || 4), 2, maxMatchSize());
    if (next === G.matchSize) return;
    audio.init();
    audio.ui();
    G.matchSize = next;
    safeStorageSet('edgecoin.matchSize', String(next));
    applyMatchSizeUI();
    if (G.phase === 'menu') {
      G.participants = [];
      G.coins = createCoins(true);
      G.active = null;
      G.activeIndex = -1;
      G.alive = G.coins.length;
      updateRoster();
      if (G.arenaOpen) drawArenaPreview();
    }
  }

  /* =========================================================
     Online duel (host-authoritative 1v1)
     ========================================================= */
  const ONLINE_SHOT_TIME = 15;
  const ONLINE_ERROR_TEXT = {
    'room-not-found': '房间不存在，或已经关闭。',
    'room-full': '房间已经满员。',
    'already-started': '这局对战已经开始。',
    'host-only': '只有房主可以执行这个操作。',
    'guest-only': '这个操作只能由挑战者执行。',
    'server-busy': '服务器房间已满，请稍后再试。',
    'invalid-body': '请求格式错误。',
    'network': '无法连接联机服务器。请用 node server.js 启动本包，并通过它提供的网址打开。',
  };

  function onlineErrorMessage(code) {
    return ONLINE_ERROR_TEXT[code] || '联机请求失败，请稍后重试。';
  }

  function extractRoomCode(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const match = raw.match(/[?&](?:join|room|code)=([A-Za-z0-9]{4,8})/);
    if (match) return match[1].toUpperCase();
    const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return cleaned.length >= 4 && cleaned.length <= 8 ? cleaned : '';
  }

  async function copyText(text) {
    if (!text) return false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) { /* fall through */ }
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      area.style.top = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch (error) {
      return false;
    }
  }

  let onlineShareBaseCache = null;
  let onlineJoinBusy = false;
  let onlineCreateBusy = false;

  async function onlineShareBase() {
    if (location.protocol === 'file:') return null;
    if (onlineShareBaseCache) return onlineShareBaseCache;
    const host = location.hostname;
    const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (!loopback) {
      onlineShareBaseCache = location.origin;
      return onlineShareBaseCache;
    }
    try {
      const response = await fetch('/api/info', { cache: 'no-store' });
      const data = await response.json();
      const lan = Array.isArray(data.lan) && data.lan.length ? data.lan[0] : null;
      if (lan) {
        onlineShareBaseCache = `${location.protocol}//${lan}:${data.port || location.port || 8130}`;
      } else {
        onlineShareBaseCache = location.origin;
      }
    } catch (error) {
      onlineShareBaseCache = location.origin;
    }
    return onlineShareBaseCache;
  }

  async function onlineInviteUrl() {
    if (!G.online || !G.online.code) return null;
    const base = await onlineShareBase();
    if (!base) return null;
    return `${base}${location.pathname}?join=${encodeURIComponent(G.online.code)}`;
  }

  function onlineProtocolReady() {
    return location.protocol === 'http:' || location.protocol === 'https:';
  }

  function onlineNameDefault() {
    const stored = safeStorageGet('edgecoin.onlineName');
    if (stored) return stored;
    const suffix = 100 + Math.floor(Math.random() * 900);
    const name = `玩家${suffix}`;
    safeStorageSet('edgecoin.onlineName', name);
    return name;
  }

  function onlineCoinDef(id) {
    return DEF_BY_ID[id] || COIN_DEFS[0];
  }

  function onlineCoinInUse(coin, exceptIndex) {
    const slots = G.online && G.online.room && G.online.room.slots ? G.online.room.slots : [];
    return slots.some((slot, index) => slot && index !== exceptIndex && slot.coin === coin);
  }

  function closeOnlineCoinPicker(immediate = false) {
    if (!dom.onlineCoinPicker) return;
    dom.onlineCoinPicker.hidden = true;
    if (G.online) G.online.pickerIndex = null;
    if (!immediate && G.onlineLobbyOpen) dom.onlineSlots?.focus?.({ preventScroll: true });
  }

  function renderOnlineCoinPicker(index) {
    const slot = G.online && G.online.room ? G.online.room.slots[index] : null;
    if (!slot || !dom.onlineCoinOptions) return;
    if (dom.onlineCoinPickerTitle) {
      dom.onlineCoinPickerTitle.textContent = `更换 ${slot.name} 的硬币`;
    }
    dom.onlineCoinOptions.innerHTML = COIN_DEFS.map((def) => {
      const current = slot.coin === def.id;
      const used = !current && onlineCoinInUse(def.id, index);
      const status = current ? '当前' : (used ? '已占用' : '可选');
      return `
        <button class="online-coin-option${current ? ' is-current' : ''}" type="button"
          data-online-coin="${def.id}" role="option" aria-selected="${current}"
          ${used || current ? 'disabled' : ''}
          style="--option-color:${def.color};--option-rgb:${def.rgb}">
          <i class="online-coin-option-orb" aria-hidden="true"></i>
          <span class="online-coin-option-info"><strong>${def.name}</strong><small>${def.role}</small></span>
          <span class="online-coin-option-status">${status}</span>
        </button>
      `;
    }).join('');
    if (dom.onlineCoinPickerHint) {
      dom.onlineCoinPickerHint.textContent = '已被其他位置占用的硬币不可选择；更换后所有人会立即看到。';
    }
  }

  function openOnlineCoinPicker(index) {
    if (!G.online || !G.online.room || !G.onlineLobbyOpen) return;
    const slot = G.online.room.slots[index];
    if (!slot) return;
    const allowed = G.online.selfSlot === index
      || (slot.type === 'ai' && G.online.role === 'host');
    if (!allowed) return;
    G.online.pickerIndex = index;
    renderOnlineCoinPicker(index);
    if (dom.onlineCoinPicker) {
      dom.onlineCoinPicker.hidden = false;
      dom.onlineCoinPicker.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  async function onlineSetCoin(coin, index) {
    if (!G.online || !G.online.code || !G.online.token) return;
    if (index === undefined || index === null) index = G.online.selfSlot;
    const room = G.online.room;
    const slot = room && room.slots ? room.slots[index] : null;
    if (!slot) return;
    try {
      const response = await fetch(`/api/rooms/${G.online.code}/action?token=${encodeURIComponent(G.online.token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'coin', coin, index }),
        cache: 'no-store',
      });
      let data = {};
      try {
        data = await response.json();
      } catch (error) {
        data = {};
      }
      if (!response.ok) {
        const code = data.error || 'request-failed';
        const message = code === 'coin-taken'
          ? '这枚硬币已被其他位置选择。'
          : code === 'not-your-slot'
            ? '你只能更换自己的硬币。'
            : code === 'slot-not-found'
              ? '这个房间位置已经不存在。'
              : '更换硬币失败，请重试。';
        onlineSetError(message, true);
        if (dom.onlineCoinPickerHint) dom.onlineCoinPickerHint.textContent = message;
        return;
      }
      if (data.room) onlineRenderRoom(data.room);
      closeOnlineCoinPicker(true);
      updateOnlineCoinPreview();
      addToast(`已更换为 ${onlineCoinDef(coin).name}`, 'info', 1800);
    } catch (error) {
      onlineSetError('网络异常，更换硬币失败。', true);
      if (dom.onlineCoinPickerHint) dom.onlineCoinPickerHint.textContent = '网络异常，请重试。';
    }
  }

  function onlineSetError(message, room = false) {
    const el = room ? dom.onlineRoomError : dom.onlineError;
    if (el) el.textContent = message || '';
  }

  function updateOnlineCoinPreview() {
    const def = onlineCoinDef((G.online && G.online.localCoin) || G.playerId);
    if (dom.onlineCoinName) dom.onlineCoinName.textContent = def.name;
    if (dom.onlineCoinOrb) {
      dom.onlineCoinOrb.style.background = def.color;
      dom.onlineCoinOrb.style.boxShadow = `0 0 0 2px ${rgba(def.color, 0.24)}, 0 0 16px ${rgba(def.color, 0.32)}`;
    }
  }

  function showOnlinePane(pane) {
    if (dom.onlineEntry) dom.onlineEntry.hidden = pane !== 'entry';
    if (dom.onlineRoom) dom.onlineRoom.hidden = pane !== 'room';
  }

  function hideOnlineLobbyUI() {
    G.onlineLobbyOpen = false;
    closeOnlineCoinPicker(true);
    dom.online.classList.remove('is-open');
    dom.online.setAttribute('aria-hidden', 'true');
    if (G.phase === 'menu') dom.menu.inert = false;
  }

  function openOnlineLobby() {
    if (G.phase !== 'menu' || G.onlineLobbyOpen) return;
    if (G.mode === 'chase') {
      addToast('追击模式暂不开放联机', 'info', 2200);
      return;
    }
    audio.init();
    audio.ui();
    clearPanKeys();
    closeHelp(true);
    closeArena(true);
    closeCodex(true);
    closeInspect(true);
    G.onlineLobbyOpen = true;
    dom.menu.inert = true;
    if (dom.onlineName) dom.onlineName.value = G.online?.name || onlineNameDefault();
    updateOnlineCoinPreview();
    onlineSetError('');
    onlineSetError('', true);
    if (G.online && G.online.code && !G.online.active) {
      showOnlinePane('room');
      onlineRenderRoom(G.online.room);
    } else {
      showOnlinePane('entry');
    }
    dom.online.classList.add('is-open');
    dom.online.setAttribute('aria-hidden', 'false');
    setTimeout(() => {
      if (!G.onlineLobbyOpen) return;
      if (G.online && G.online.code && !G.online.active) dom.onlineLeave.focus({ preventScroll: true });
      else dom.onlineCreate.focus({ preventScroll: true });
    }, 120);
    if (!onlineProtocolReady()) {
      onlineSetError(ONLINE_ERROR_TEXT.network);
    }
  }

  function closeOnlineLobby() {
    if (!G.onlineLobbyOpen) return;
    closePersonalityPool(true);
    if (G.online && !G.online.active) shutdownOnlineSession();
    hideOnlineLobbyUI();
    audio.ui();
    dom.onlineBtn.focus({ preventScroll: true });
  }

  async function onlineRequest(path, body = {}) {
    if (!onlineProtocolReady()) throw new Error('offline');
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    let data = {};
    try {
      data = await response.json();
    } catch (error) {
      data = {};
    }
    if (!response.ok) {
      const error = new Error(data.error || 'request-failed');
      error.code = data.error || 'request-failed';
      throw error;
    }
    return data;
  }

  function sendOnlineAction(type, payload = {}) {
    if (!G.online || !G.online.code || !G.online.token) return Promise.resolve(false);
    return fetch(`/api/rooms/${G.online.code}/action?token=${encodeURIComponent(G.online.token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, ...payload }),
      cache: 'no-store',
      keepalive: type === 'leave',
    }).then((response) => response.ok).catch(() => false);
  }

  function openOnlineStream() {
    if (!G.online || !G.online.code || !G.online.token) return;
    if (G.online.eventSource) {
      G.online.eventSource.close();
      G.online.eventSource = null;
    }
    const source = new EventSource(`/api/events?code=${encodeURIComponent(G.online.code)}&token=${encodeURIComponent(G.online.token)}`);
    G.online.eventSource = source;
    source.addEventListener('open', () => {
      G.online.connected = true;
      onlineSetError('');
      if (G.online.room) onlineRenderRoom(G.online.room);
    });
    source.addEventListener('error', () => {
      G.online.connected = false;
      if (!G.online.active) onlineSetError('连接中断，正在尝试重连…');
      else if (!G.online.peerLeftNotice) {
        G.online.peerLeftNotice = true;
        addToast('联机连接中断，正在重连…', 'out', 2400);
      }
    });
    source.addEventListener('message', (event) => {
      let payload = null;
      try {
        payload = JSON.parse(event.data);
      } catch (error) {
        return;
      }
      if (payload) handleOnlineEvent(payload);
    });
  }

  function onlineModeText(mode) {
    return mode === 'volley' ? '齐射 · 所有硬币锁定后同时发射' : '轮流出手 · 每局顺序随机';
  }

  function onlineArenaSummaryText(arena) {
    if (!arena) return '沿用当前战场';
    const shape = ARENA_SHAPES[arena.shape] || ARENA_SHAPES.circle;
    const size = Math.round((Number(arena.size) || 1) * 100);
    const walls = arena.walls && arena.walls[arena.shape]
      ? arena.walls[arena.shape].filter(Boolean).length
      : 0;
    const limit = Math.round(Number(arena.turnLimit) || 0);
    const rate = Math.round(Number(arena.shrinkRate) || 0);
    const obstacles = arena.obstacles ? sanitizeObstacleConfig(arena.obstacles).count : 0;
    const shrink = limit > 0 ? `第 ${limit + 1} 回合起收缩 ${rate}%` : '不收缩';
    return `${shape.name} · ${size}%${walls ? ` · ${walls} 面墙` : ''}${obstacles ? ` · ${obstacles} 障碍` : ''} · ${shrink}`;
  }

  function updateShotClockUI() {
    if (!dom.shotClock) return;
    const timer = G.online && G.online.active ? G.online.timer : null;
    if (!timer) {
      dom.shotClock.hidden = true;
      if (dom.shotClockBig) dom.shotClockBig.hidden = true;
      return;
    }
    dom.shotClock.hidden = false;
    dom.shotClock.dataset.mode = timer.mode;
    dom.shotClock.title = timer.mode === 'volley' ? '齐射锁定倒计时' : '发射倒计时';
    const seconds = Math.max(0, Math.ceil(timer.remaining));
    dom.shotClockValue.textContent = String(seconds);
    const low = timer.remaining <= 5.05;
    dom.shotClock.classList.toggle('is-low', low);
    if (dom.shotClockBig) {
      dom.shotClockBig.hidden = false;
      dom.shotClockBig.classList.toggle('is-low', low);
      dom.shotClockBigLabel.textContent = timer.mode === 'volley' ? '锁定倒计时' : '发射倒计时';
      dom.shotClockBigValue.textContent = String(seconds);
      const ratio = timer.total > 0 ? clamp(timer.remaining / timer.total, 0, 1) : 0;
      dom.shotClockBigFill.style.width = `${(ratio * 100).toFixed(1)}%`;
    }
  }

  function startOnlineShotTimer(mode, coinId = null) {
    if (!G.online || G.online.role !== 'host' || !G.online.active) return;
    G.online.timer = {
      mode,
      coinId,
      remaining: ONLINE_SHOT_TIME,
      total: ONLINE_SHOT_TIME,
    };
    updateShotClockUI();
  }

  function clearOnlineShotTimer() {
    if (!G.online) return;
    G.online.timer = null;
    updateShotClockUI();
  }

  function onlineRegisterSkip(text) {
    if (!G.online) return;
    G.online.skipSerial = (G.online.skipSerial || 0) + 1;
    G.online.skipText = text;
    addToast(text, 'out', 2800);
  }

  function skipOnlineTurn() {
    if (G.phase !== 'playerAim' && G.phase !== 'onlineWait') return;
    if (!G.active || !G.online) return;
    const active = G.active;
    const name = (G.online.names && G.online.names[active.id]) || active.name;
    const wasProtected = isFirstShotProtected(active);
    if (wasProtected) active.hasFired = true;
    if (G.anchorBonus && G.anchorBonus.aiming) {
      active.anchorHeld = false;
      G.anchorBonus = null;
    }
    clearOnlineShotTimer();
    G.aim.charging = false;
    G.aim.power = 0;
    G.aim.chargeT = 0;
    G.pointer.down = false;
    audio.stopCharge();
    onlineRegisterSkip(`${name} 超时未发射 · 跳过该硬币${wasProtected ? ' · 首发保护解除' : ''}`);
    G.phase = 'resolve';
    G.resolve = { elapsed: 0, still: 0, delay: 0.7 };
    G.ai.plan = null;
    G.pending = null;
    updateRoster();
    updateHUD(true);
  }

  function skipOnlineVolley() {
    if (G.phase !== 'volleyAim' || !G.volley) return;
    const unlocked = G.coins.filter((coin) => coin.alive && !coin.locked);
    if (!unlocked.length) {
      clearOnlineShotTimer();
      return;
    }
    unlocked.forEach((coin) => {
      coin.locked = true;
      coin.volleySkipped = true;
      G.volley.locked += 1;
      G.volley.skipped = (G.volley.skipped || 0) + 1;
    });
    const local = G.coins.find((coin) => coin.id === G.online.localCoin);
    if (local && local.volleySkipped) G.volley.playerLocked = true;
    clearOnlineShotTimer();
    onlineRegisterSkip(`锁定超时 · ${unlocked.length} 枚硬币跳过本轮齐射`);
    updateRoster();
    updateHUD(true);
    maybeStartVolleyFire();
  }

  function updateOnlineShotTimer(dt) {
    if (!G.online || G.online.role !== 'host' || !G.online.active) return;
    const timer = G.online.timer;
    if (!timer) {
      updateShotClockUI();
      return;
    }
    const valid = timer.mode === 'turn'
      ? (G.phase === 'playerAim' || G.phase === 'onlineWait')
      : (G.phase === 'volleyAim' && !!G.volley && !G.volley.firing);
    if (!valid) {
      clearOnlineShotTimer();
      return;
    }
    timer.remaining = Math.max(0, timer.remaining - dt);
    updateShotClockUI();
    if (timer.remaining <= 0) {
      if (timer.mode === 'turn') skipOnlineTurn();
      else skipOnlineVolley();
    }
  }

  function updateGuestOnlineTimer(dt) {
    if (!G.online || G.online.role !== 'guest' || !G.online.active) return;
    const timer = G.online.timer;
    if (!timer) {
      updateShotClockUI();
      return;
    }
    if (timer.remaining > 0) {
      timer.remaining = Math.max(0, timer.remaining - dt);
      if (timer.remaining <= 0) {
        if (G.aim.charging) audio.stopCharge();
        G.aim.charging = false;
        G.aim.power = 0;
        G.aim.chargeT = 0;
        G.pointer.down = false;
      }
    }
    updateShotClockUI();
  }

  function onlineFilledSlots(room) {
    return (room && Array.isArray(room.slots) ? room.slots : []).filter(Boolean);
  }

  function onlineSlotCard(slot, index, room) {
    const card = document.createElement('div');
    card.className = 'online-slot';
    card.dataset.index = String(index);
    const tag = document.createElement('span');
    tag.className = 'online-slot-tag';
    const idx = document.createElement('span');
    idx.className = 'online-slot-index';
    idx.textContent = String(index + 1).padStart(2, '0');
    if (!slot) {
      card.classList.add('is-empty');
      tag.textContent = '空位';
      card.appendChild(tag);
      const orb = document.createElement('i');
      orb.className = 'online-slot-orb';
      orb.style.opacity = '0.16';
      card.appendChild(orb);
      const label = document.createElement('span');
      label.className = 'online-slot-empty-label';
      label.textContent = '等待玩家';
      card.appendChild(label);
      if (G.online && G.online.role === 'host' && onlineFilledSlots(room).length < 8) {
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'online-slot-add';
        add.dataset.onlineAiAdd = String(index);
        add.textContent = '+ AI';
        card.appendChild(add);
      }
      card.appendChild(idx);
      return card;
    }
    card.classList.add(`is-${slot.type}`);
    if (G.online && G.online.selfSlot === index) card.classList.add('is-local');
    if (slot.type === 'guest' && !slot.connected) card.classList.add('is-offline');
    tag.textContent = slot.type === 'host'
      ? (G.online && G.online.selfSlot === index ? '房主 · 你' : '房主')
      : slot.type === 'ai'
        ? 'AI'
        : (G.online && G.online.selfSlot === index ? '玩家 · 你' : '玩家');
    card.appendChild(tag);
    const def = onlineCoinDef(slot.coin);
    const orb = document.createElement('i');
    orb.className = 'online-slot-orb';
    orb.style.setProperty('--slot-color', def.color);
    if (slot.type === 'guest' && !slot.connected) orb.style.opacity = '0.35';
    card.appendChild(orb);
    const name = document.createElement('strong');
    name.textContent = slot.name;
    card.appendChild(name);
    const coin = document.createElement('small');
    coin.textContent = `${def.name} · ${slot.coin.toUpperCase()}`;
    card.appendChild(coin);
    const canSwapCoin = (G.online && G.online.selfSlot === index)
      || (slot.type === 'ai' && G.online && G.online.role === 'host');
    if (canSwapCoin) {
      const swap = document.createElement('button');
      swap.type = 'button';
      swap.className = 'online-slot-coin';
      swap.dataset.onlineCoinIndex = String(index);
      swap.textContent = '换硬币';
      card.appendChild(swap);
    }
    if (slot.type === 'ai' && G.online && G.online.role === 'host') {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'online-slot-remove';
      remove.dataset.onlineAiRemove = String(index);
      remove.textContent = '移除 AI';
      card.appendChild(remove);
    }
    if (slot.type === 'guest' && !slot.connected) {
      const offline = document.createElement('small');
      offline.textContent = '连接中断';
      offline.style.color = '#ff8a96';
      card.appendChild(offline);
    }
    card.appendChild(idx);
    return card;
  }

  function onlineRenderRoom(room) {
    if (!room || !G.online) return;
    if (dom.onlineCoinPicker && !dom.onlineCoinPicker.hidden) closeOnlineCoinPicker(true);
    G.online.room = room;
    G.online.slots = room.slots;
    G.online.mode = room.mode || 'turn';
    const filled = onlineFilledSlots(room);
    const localSlot = room.slots[G.online.selfSlot] || null;
    if (localSlot) {
      G.online.localCoin = localSlot.coin;
      G.online.name = localSlot.name;
    }
    const host = room.slots[0] || null;
    if (host) G.online.hostCoin = host.coin;
    G.online.peerConnected = filled.some((slot) => slot.type === 'guest' && slot.connected);
    if (dom.onlineRoomCode) dom.onlineRoomCode.textContent = room.code;
    if (dom.onlineSlots) {
      dom.onlineSlots.innerHTML = '';
      for (let i = 0; i < 8; i += 1) {
        dom.onlineSlots.appendChild(onlineSlotCard(room.slots[i] || null, i, room));
      }
    }
    if (dom.onlineModeButtons) {
      dom.onlineModeButtons.forEach((button) => {
        const mode = button.dataset.mode;
        const active = mode === G.online.mode;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
        button.disabled = G.online.role !== 'host';
      });
    }
    if (dom.onlineModeNote) dom.onlineModeNote.textContent = onlineModeText(G.online.mode);
    const arena = room.arena || G.online.roomArena || (G.online.role === 'host' ? onlineArenaConfig() : null);
    G.online.roomArena = arena;
    if (dom.onlineArenaSummary) dom.onlineArenaSummary.textContent = onlineArenaSummaryText(arena);
    if (dom.onlineArenaBtn) dom.onlineArenaBtn.hidden = G.online.role !== 'host';
    const pool = G.online.role === 'host'
      ? G.personalityPool
      : (room.personalityPool || G.personalityPool);
    G.online.roomPool = sanitizePersonalityPool(pool);
    if (dom.onlinePoolSummary) dom.onlinePoolSummary.textContent = personalityPoolSummaryText(G.online.roomPool);
    if (dom.onlinePoolBtn) dom.onlinePoolBtn.hidden = G.online.role !== 'host';
    if (dom.onlineSlotCount) dom.onlineSlotCount.textContent = `${filled.length} / 8 人`;
    const anyGuestOffline = filled.some((slot) => slot.type === 'guest' && !slot.connected);
    const enough = filled.length >= 2;
    if (dom.onlineFillAI) {
      dom.onlineFillAI.hidden = G.online.role !== 'host';
      dom.onlineFillAI.disabled = filled.length >= 8;
    }
    if (dom.onlineStart) {
      if (G.online.role === 'host') {
        dom.onlineStart.hidden = false;
        dom.onlineStart.disabled = !enough || anyGuestOffline;
        dom.onlineStart.textContent = !enough
          ? '至少需要 2 人'
          : (anyGuestOffline ? '等待玩家连接' : `开始对战 · ${filled.length} 人`);
      } else {
        dom.onlineStart.hidden = true;
      }
    }
    if (dom.onlineRoomHint) {
      if (G.online.role === 'host') {
        if (!enough) dom.onlineRoomHint.textContent = '再邀请一位玩家，或给空位添加 AI 后开始。';
        else if (anyGuestOffline) dom.onlineRoomHint.textContent = '有玩家连接中断，等待重连或移除该位置。';
        else dom.onlineRoomHint.textContent = `已就绪：${filled.length} 人。未满 8 人也可以开始。`;
      } else {
        dom.onlineRoomHint.textContent = '等待房主添加 AI 或开始对战。';
      }
    }
    onlineSetError('');
  }

  function maybeJoinFromInvite() {
    if (G.phase !== 'menu' || G.online) return;
    const params = new URLSearchParams(location.search);
    const code = extractRoomCode(params.get('join') || params.get('room') || '');
    if (!code) return;
    openOnlineLobby();
    if (dom.onlineCode) dom.onlineCode.value = code;
    onlineSetError('已识别邀请链接，正在加入房间…');
    setTimeout(() => {
      if (G.onlineLobbyOpen && !G.online) onlineJoinRoom();
    }, 380);
  }

  async function onlineCreateRoom() {
    if (!onlineProtocolReady()) {
      onlineSetError(ONLINE_ERROR_TEXT.network);
      return;
    }
    if (G.online && G.online.active) return;
    if (onlineCreateBusy) return;
    clearOnlineSessionOnly();
    const name = cleanOnlineName(dom.onlineName?.value);
    safeStorageSet('edgecoin.onlineName', name);
    onlineCreateBusy = true;
    dom.onlineCreate.disabled = true;
    onlineSetError('');
    try {
      const data = await onlineRequest('/api/rooms', {
        name,
        coin: G.playerId,
        mode: G.mode,
        arena: onlineArenaConfig(),
        personalityPool: G.personalityPool,
      });
      G.online = {
        role: 'host',
        code: data.code,
        token: data.token,
        selfSlot: 0,
        name: data.room.slots[0].name,
        room: data.room,
        slots: data.room.slots,
        mode: data.room.mode,
        localCoin: data.room.slots[0].coin,
        hostCoin: data.room.slots[0].coin,
        active: false,
        connected: false,
        peerConnected: false,
        lastTurn: 0,
        lastAnchorBonus: 0,
        anchorSent: false,
        lastVolleyRound: 0,
        lockSentRound: 0,
        shotSent: false,
        resultSent: false,
        resultReceived: false,
      };
      onlineRenderRoom(data.room);
      showOnlinePane('room');
      openOnlineStream();
      audio.ui();
      onlineInviteUrl().then((url) => {
        if (!url) return;
        copyText(url).then((ok) => {
          if (ok) addToast('邀请链接已复制，直接发给朋友即可', 'info', 2600);
        });
      }).catch(() => {});
    } catch (error) {
      onlineSetError(error.code ? onlineErrorMessage(error.code) : ONLINE_ERROR_TEXT.network);
    } finally {
      onlineCreateBusy = false;
      dom.onlineCreate.disabled = false;
    }
  }

  async function onlineJoinRoom() {
    if (!onlineProtocolReady()) {
      onlineSetError(ONLINE_ERROR_TEXT.network);
      return;
    }
    if (G.online && G.online.active) return;
    if (onlineJoinBusy) return;
    const code = extractRoomCode(dom.onlineCode?.value);
    if (!code) {
      onlineSetError('请输入 5 位房间码，或粘贴邀请链接。');
      return;
    }
    const name = cleanOnlineName(dom.onlineName?.value);
    safeStorageSet('edgecoin.onlineName', name);
    clearOnlineSessionOnly();
    onlineJoinBusy = true;
    dom.onlineJoin.disabled = true;
    onlineSetError('');
    try {
      const data = await onlineRequest(`/api/rooms/${encodeURIComponent(code)}/join`, {
        name,
        coin: G.playerId,
      });
      if (data.assignedCoin && data.assignedCoin !== G.playerId) {
        selectPlayer(data.assignedCoin);
        addToast(`该硬币已被选择，系统为你分配了${onlineCoinDef(data.assignedCoin).name}`, 'info', 2800);
      }
      G.online = {
        role: 'guest',
        code: data.room.code,
        token: data.token,
        selfSlot: data.slot,
        name: data.room.slots[data.slot].name,
        room: data.room,
        slots: data.room.slots,
        mode: data.room.mode,
        localCoin: data.room.slots[data.slot].coin,
        hostCoin: data.room.slots[0].coin,
        active: false,
        connected: false,
        peerConnected: false,
        lastTurn: 0,
        lastAnchorBonus: 0,
        anchorSent: false,
        lastVolleyRound: 0,
        lockSentRound: 0,
        shotSent: false,
        resultSent: false,
        resultReceived: false,
      };
      dom.onlineCode.value = data.room.code;
      const params = new URLSearchParams(location.search);
      if (extractRoomCode(params.get('join') || params.get('room') || '') === data.room.code) {
        history.replaceState({}, '', location.pathname);
      }
      onlineRenderRoom(data.room);
      showOnlinePane('room');
      openOnlineStream();
      audio.ui();
      if (data.coinAdjusted) {
        const localSlot = data.room.slots[data.slot];
        onlineSetError(`该硬币已被其他玩家选择，你自动使用${onlineCoinDef(localSlot.coin).name}。`, true);
      }
    } catch (error) {
      onlineSetError(error.code ? onlineErrorMessage(error.code) : ONLINE_ERROR_TEXT.network);
    } finally {
      onlineJoinBusy = false;
      dom.onlineJoin.disabled = false;
    }
  }

  function cleanOnlineName(value) {
    const name = String(value || '').replace(/[\u0000-\u001f<>]/g, '').trim();
    return name.slice(0, 12) || '玩家';
  }

  function onlineArenaConfig() {
    return {
      shape: G.arena.shape,
      size: G.arena.size,
      walls: sanitizeWalls(G.arena.walls, G.arena.shape),
      turnLimit: G.arena.turnLimit,
      shrinkRate: G.arena.shrinkRate,
      obstacles: sanitizeObstacleConfig(G.arena.obstacles),
    };
  }

  function applyOnlineArenaConfig(config) {
    if (!config) return;
    G.arena.shape = Object.prototype.hasOwnProperty.call(ARENA_SHAPES, config.shape) ? config.shape : 'circle';
    G.arena.size = clamp(Number(config.size) || 1, ARENA_MIN_SIZE, ARENA_MAX_SIZE);
    G.arena.walls = sanitizeWalls(config.walls);
    G.arena.turnLimit = clamp(Math.round(Number(config.turnLimit) || 0), 0, 30);
    G.arena.shrinkRate = clamp(Math.round(Number(config.shrinkRate) || 6), 2, 15);
    G.arena.obstacles = sanitizeObstacleConfig(config.obstacles || DEFAULT_OBSTACLE_CONFIG);
    G.arena.shrink = 1;
    updateArenaRadius();
  }

  async function onlineSetAI(action, index) {
    if (!G.online || G.online.role !== 'host' || G.online.active) return;
    onlineSetError('', true);
    const ok = await sendOnlineAction('ai', { action, index });
    if (!ok) onlineSetError('AI 位置更新失败，请重试。', true);
  }

  async function onlineFillAI() {
    if (!G.online || G.online.role !== 'host' || G.online.active) return;
    onlineSetError('', true);
    const ok = await sendOnlineAction('ai', { action: 'fill' });
    if (!ok) onlineSetError('补齐 AI 失败，请重试。', true);
  }

  async function onlineChangeMode(mode) {
    if (!G.online || G.online.role !== 'host' || G.online.active) return;
    if (mode !== 'turn' && mode !== 'volley') return;
    if (mode === G.online.mode) return;
    const ok = await sendOnlineAction('setting', { mode });
    if (!ok) onlineSetError('模式切换失败，请重试。', true);
  }

  async function onlineStartMatch() {
    if (!G.online || G.online.role !== 'host' || G.online.active) return;
    const room = G.online.room;
    if (!room) return;
    const filled = onlineFilledSlots(room);
    if (filled.length < 2) {
      onlineSetError('至少需要 2 个位置才能开始；可以邀请玩家或添加 AI。', true);
      return;
    }
    if (filled.some((slot) => slot.type === 'guest' && !slot.connected)) {
      onlineSetError('有玩家尚未连接成功，请稍等。', true);
      return;
    }
    const config = {
      mode: room.mode === 'volley' ? 'volley' : 'turn',
      arena: onlineArenaConfig(),
      participants: filled.map((slot) => ({
        slot: slot.index,
        coin: slot.coin,
        name: slot.name,
        type: slot.type,
      })),
    };
    dom.onlineStart.disabled = true;
    const sent = await sendOnlineAction('start', { config });
    if (!sent) {
      dom.onlineStart.disabled = false;
      onlineSetError('开始信号发送失败，请检查网络后重试。', true);
      return;
    }
    hideOnlineLobbyUI();
    startHostOnline(config);
  }

  function onlineSetupParticipants(config) {
    const list = (config.participants || []).slice().sort((a, b) => a.slot - b.slot);
    const controllers = {};
    const names = {};
    const slotByCoin = {};
    for (const entry of list) {
      controllers[entry.coin] = entry.type;
      names[entry.coin] = entry.name;
      slotByCoin[entry.coin] = entry.slot;
    }
    return {
      list,
      coins: list.map((entry) => entry.coin),
      controllers,
      names,
      slotByCoin,
      mode: config.mode === 'volley' ? 'volley' : 'turn',
    };
  }

  function startHostOnline(config) {
    if (!G.online) return;
    stopOnlineSnapshots();
    const o = G.online;
    if (!o.restore) {
      o.restore = {
        mode: G.mode,
        matchSize: G.matchSize,
        arena: JSON.parse(JSON.stringify(G.arena)),
      };
    }
    const setup = onlineSetupParticipants(config);
    const hostEntry = setup.list.find((entry) => entry.type === 'host') || setup.list[0];
    o.active = true;
    o.initializing = true;
    o.started = true;
    o.mode = setup.mode;
    o.participants = setup.list;
    o.participantCoins = setup.coins;
    o.controllers = setup.controllers;
    o.names = setup.names;
    o.slotByCoin = setup.slotByCoin;
    o.localCoin = hostEntry.coin;
    o.hostCoin = hostEntry.coin;
    o.matchSize = setup.coins.length;
    o.config = JSON.parse(JSON.stringify(config));
    o.resultSent = false;
    o.resultReceived = false;
    o.shotSent = false;
    o.lockSentRound = 0;
    o.lastTurn = 0;
    o.lastVolleyRound = 0;
    o.peerLeftNotice = false;
    G.playerId = o.localCoin;
    G.mode = o.mode;
    G.matchSize = o.matchSize;
    G.participants = o.participantCoins.slice();
    applyOnlineArenaConfig(config.arena);
    startGame();
    o.initializing = false;
    hideOnlineLobbyUI();
    dom.menu.inert = true;
    dom.onlineExitBtn.hidden = false;
    startOnlineSnapshots();
    addToast(`联机对战 · ${o.matchSize} 人 · ${o.mode === 'volley' ? '齐射' : '轮流'}`, 'info', 2400);
  }

  function startGuestOnline(config) {
    if (!G.online) return;
    const o = G.online;
    closeResult(true);
    if (!o.restore) {
      o.restore = {
        mode: G.mode,
        matchSize: G.matchSize,
        arena: JSON.parse(JSON.stringify(G.arena)),
      };
    }
    const setup = onlineSetupParticipants(config);
    const localEntry = setup.list.find((entry) => entry.slot === o.selfSlot);
    if (!localEntry) return;
    o.active = true;
    o.initializing = true;
    o.started = true;
    o.mode = setup.mode;
    o.participants = setup.list;
    o.participantCoins = setup.coins;
    o.controllers = setup.controllers;
    o.names = setup.names;
    o.slotByCoin = setup.slotByCoin;
    o.localCoin = localEntry.coin;
    o.matchSize = setup.coins.length;
    o.config = JSON.parse(JSON.stringify(config));
    o.resultSent = false;
    o.resultReceived = false;
    o.shotSent = false;
    o.lockSentRound = 0;
    o.lastTurn = 0;
    o.lastVolleyRound = 0;
    o.peerLeftNotice = false;
    G.playerId = o.localCoin;
    G.mode = o.mode;
    G.matchSize = o.matchSize;
    G.participants = o.participantCoins.slice();
    applyOnlineArenaConfig(config.arena);
    startGame();
    o.initializing = false;
    hideOnlineLobbyUI();
    dom.menu.inert = true;
    dom.onlineExitBtn.hidden = false;
    G.coins.forEach((coin) => {
      coin.spawn = 1;
      coin.spawnDelay = 0;
      coin.active = false;
    });
    const firstCoin = G.coins.find((coin) => coin.id === o.participantCoins[0]);
    const localCoin = G.coins.find((coin) => coin.id === o.localCoin);
    G.turn = 0;
    G.phase = 'onlineWait';
    G.activeIndex = firstCoin ? G.coins.indexOf(firstCoin) : -1;
    G.active = firstCoin || null;
    if (firstCoin) {
      firstCoin.active = true;
      G.aim.angle = Math.atan2(-firstCoin.y, -firstCoin.x);
    }
    if (localCoin) G.playerOut = !localCoin.alive;
    G.aim.charging = false;
    G.aim.power = 0;
    o.lastTurn = 0;
    o.shotSent = false;
    showBanner('ONLINE', '已连接', `${o.matchSize} 人 · ${o.mode === 'volley' ? '齐射' : '轮流'} · 房间 ${o.code}`, 1900);
    updateRoster();
    updateHUD(true);
    addToast(`已加入联机对战 · ${o.matchSize} 人`, 'info', 2400);
  }

  function startOnlineSnapshots() {
    stopOnlineSnapshots();
    if (!G.online || G.online.role !== 'host') return;
    const tick = () => {
      if (!G.online || !G.online.active || G.online.role !== 'host') return;
      if (!G.online.peerConnected || G.online.snapshotBusy || G.phase === 'menu') return;
      if (G.online.resultSent) return;
      G.online.snapshotBusy = true;
      const snapshot = {
        phase: G.phase,
        turn: G.turn,
        active: G.active ? G.active.id : null,
        activeName: G.online.activeName || (G.active ? G.active.name : null),
        activeType: G.online.activeType || null,
        timer: G.online.timer ? {
          mode: G.online.timer.mode,
          coinId: G.online.timer.coinId,
          remaining: G.online.timer.remaining,
          total: G.online.timer.total,
        } : null,
        skipSerial: G.online.skipSerial || 0,
        skipText: G.online.skipText || null,
        anchorBonus: G.anchorBonus ? {
          coinId: G.anchorBonus.coinId,
          serial: G.anchorBonus.serial,
          aiming: !!G.anchorBonus.aiming,
        } : null,
        alive: G.alive,
        winnerId: G.winnerId,
        arenaShrink: G.arena.shrink,
        volley: G.volley ? {
          round: G.volley.round,
          alive: G.volley.alive,
          locked: G.volley.locked,
          skipped: G.volley.skipped || 0,
          firing: G.volley.firing,
        } : null,
        stats: { ...G.stats },
        coins: G.coins.map((coin) => ({
          id: coin.id,
          x: coin.x,
          y: coin.y,
          vx: coin.vx,
          vy: coin.vy,
          rot: coin.rot,
          spin: coin.spin,
          alive: coin.alive,
          active: coin.active,
          out: coin.out,
          fall: coin.fall,
          hasFired: coin.hasFired,
          locked: !!coin.locked,
          skipped: !!coin.volleySkipped,
          marker: coin.marker ? { x: coin.marker.x, y: coin.marker.y } : null,
          skillCooldown: coin.skillCooldown || 0,
          skillReady: !!coin.skillReady,
          danger: coin.danger,
          flash: coin.flash,
          squash: coin.squash,
          personality: coin.personality ? coin.personality.id : null,
          energy: Number(coin.energy) || 0,
          curveActive: !!coin.curveActive,
        })),
        obstacles: G.obstacles.map((obstacle) => ({
          id: obstacle.id,
          shape: obstacle.shape,
          type: obstacle.type,
          x: obstacle.x,
          y: obstacle.y,
          vx: obstacle.vx,
          vy: obstacle.vy,
          radius: obstacle.radius,
          mass: obstacle.mass,
          rot: obstacle.rot,
          flash: obstacle.flash,
        })),
      };
      sendOnlineAction('snapshot', { snapshot })
        .finally(() => {
          if (G.online) G.online.snapshotBusy = false;
        });
    };
    G.online.snapshotTimer = setInterval(tick, 55);
    tick();
  }

  function stopOnlineSnapshots() {
    if (!G.online) return;
    if (G.online.snapshotTimer) clearInterval(G.online.snapshotTimer);
    G.online.snapshotTimer = null;
    G.online.snapshotBusy = false;
  }

  function applyOnlineSnapshot(snapshot) {
    if (!G.online || G.online.role !== 'guest' || !G.online.active || !snapshot) return;
    if (G.online.resultReceived) return;
    if (snapshot.phase === 'intro') {
      if (Array.isArray(snapshot.coins)) {
        for (const data of snapshot.coins) {
          if (data.personality !== 'blackdog') continue;
          const coin = G.coins.find((item) => item.id === data.id);
          if (!coin) continue;
          coin.personality = AI_PERSONALITIES.find((personality) => personality.id === 'blackdog')
            || coin.personality;
          if (!coin.blackdogFxTriggered && G.phase === 'intro') triggerBlackdogEntrance(coin);
        }
      }
      return;
    }
    if (!Array.isArray(snapshot.coins)) return;
    const o = G.online;
    const turnChanged = snapshot.turn !== o.lastTurn;
    if (snapshot.arenaShrink && Math.abs(snapshot.arenaShrink - G.arena.shrink) > 0.0002) {
      G.arena.shrink = snapshot.arenaShrink;
      updateArenaRadius();
      updateArenaHudLabel();
    }
    G.turn = Math.max(0, Number(snapshot.turn) || 0);
    G.alive = Number(snapshot.alive) || G.alive;
    G.winnerId = snapshot.winnerId || null;
    if (snapshot.stats) {
      G.stats = { ...G.stats, ...snapshot.stats };
    }
    o.activeName = snapshot.activeName || o.activeName;
    o.activeType = snapshot.activeType || o.activeType;
    o.timer = snapshot.timer ? {
      mode: snapshot.timer.mode,
      coinId: snapshot.timer.coinId,
      remaining: Number(snapshot.timer.remaining) || 0,
      total: Number(snapshot.timer.total) || ONLINE_SHOT_TIME,
    } : null;
    const bonusSerial = snapshot.anchorBonus ? Number(snapshot.anchorBonus.serial) || 0 : 0;
    G.anchorBonus = snapshot.anchorBonus ? {
      coinId: snapshot.anchorBonus.coinId,
      serial: bonusSerial,
      aiming: !!snapshot.anchorBonus.aiming,
    } : null;
    if (bonusSerial > (o.lastAnchorBonus || 0)) {
      o.lastAnchorBonus = bonusSerial;
      o.shotSent = false;
      o.anchorSent = false;
      G.aim.charging = false;
      G.aim.power = 0;
      G.aim.chargeT = 0;
      audio.stopCharge();
    }
    if (Number(snapshot.skipSerial) > (o.lastSkipSerial || 0)) {
      o.lastSkipSerial = Number(snapshot.skipSerial);
      if (snapshot.skipText) addToast(snapshot.skipText, 'out', 2800);
    }
    for (const data of snapshot.coins) {
      const coin = G.coins.find((item) => item.id === data.id);
      if (!coin) continue;
      coin.prevX = coin.x;
      coin.prevY = coin.y;
      coin.targetX = Number(data.x) || 0;
      coin.targetY = Number(data.y) || 0;
      coin.syncT = 0;
      coin.vx = Number(data.vx) || 0;
      coin.vy = Number(data.vy) || 0;
      coin.rot = Number(data.rot) || 0;
      coin.spin = Number(data.spin) || 0;
      coin.alive = !!data.alive;
      coin.active = !!data.active;
      coin.out = !!data.out;
      coin.fall = Number(data.fall) || 0;
      coin.hasFired = !!data.hasFired;
      coin.locked = !!data.locked;
      coin.volleySkipped = !!data.skipped;
      coin.marker = data.marker ? { x: Number(data.marker.x), y: Number(data.marker.y), born: G.time } : null;
      coin.skillCooldown = Number(data.skillCooldown) || 0;
      coin.skillReady = !!data.skillReady;
      coin.danger = Number(data.danger) || 0;
      coin.flash = Number(data.flash) || 0;
      coin.squash = Number(data.squash) || 0;
      coin.spawn = 1;
      coin.spawnDelay = 0;
      coin.speed = Math.hypot(coin.vx, coin.vy);
      if (coin.def.id === 'curve') {
        coin.energy = Math.max(0, Number(data.energy) || 0);
        coin.curveActive = !!data.curveActive;
      }
      if (coin.id === o.localCoin) coin.personality = null;
      else if (data.personality) {
        coin.personality = AI_PERSONALITIES.find((personality) => personality.id === data.personality)
          || coin.personality;
      }
    }
    if (Array.isArray(snapshot.obstacles)) {
      G.obstacles = snapshot.obstacles.map((data, index) => ({
        id: data.id || `obstacle-${index + 1}`,
        shape: OBSTACLE_SHAPES[data.shape] ? data.shape : 'circle',
        type: data.type === 'movable' ? 'movable' : 'fixed',
        movable: data.type === 'movable',
        x: Number(data.x) || 0,
        y: Number(data.y) || 0,
        vx: Number(data.vx) || 0,
        vy: Number(data.vy) || 0,
        radius: Number(data.radius) || 30,
        mass: Number(data.mass) || 0,
        rot: Number(data.rot) || 0,
        spin: 0,
        flash: Number(data.flash) || 0,
      }));
    }
    syncAIPersonaButton();
    const localCoin = G.coins.find((coin) => coin.id === o.localCoin);
    G.playerOut = !localCoin || !localCoin.alive;
    const snapshotActive = snapshot.active ? G.coins.find((coin) => coin.id === snapshot.active) : null;
    const volleyPhase = snapshot.phase === 'volleyAim';
    const activeCoin = volleyPhase
      ? (localCoin && localCoin.alive ? localCoin : null)
      : snapshotActive;
    G.active = activeCoin || null;
    G.activeIndex = activeCoin ? G.coins.indexOf(activeCoin) : -1;
    G.coins.forEach((coin) => { coin.active = !!activeCoin && coin === activeCoin; });

    if (volleyPhase) {
      G.phase = 'volleyAim';
      const data = snapshot.volley || {};
      G.volley = {
        round: Number(data.round) || G.turn || 1,
        alive: Number(data.alive) || G.coins.filter((coin) => coin.alive).length,
        locked: Number(data.locked) || 0,
        skipped: Number(data.skipped) || 0,
        elapsed: 0,
        fireTimer: 0,
        firing: !!data.firing,
        playerLocked: !!(localCoin && localCoin.locked),
      };
      const newRound = o.lastVolleyRound !== G.volley.round;
      if (newRound) {
        o.lastVolleyRound = G.volley.round;
        o.lockSentRound = 0;
        o.shotSent = false;
        G.aim.charging = false;
        G.aim.power = 0;
        G.aim.chargeT = 0;
        G.dangerNotified = false;
        if (localCoin) G.aim.angle = Math.atan2(-localCoin.y, -localCoin.x);
        audio.turn();
      }
      if (localCoin && o.lockSentRound === G.volley.round) {
        localCoin.locked = true;
        G.volley.playerLocked = true;
      }
      if (!canPlayerAim()) {
        if (G.aim.charging) audio.stopCharge();
        G.aim.charging = false;
        if (!localCoin || !localCoin.alive || localCoin.locked || G.volley.firing) {
          G.aim.power = 0;
          G.aim.chargeT = 0;
        }
      }
    } else {
      let localPhase = snapshot.phase;
      if (snapshot.phase === 'playerAim' || snapshot.phase === 'aiAim') localPhase = 'onlineWait';
      else if (snapshot.phase === 'onlineWait') {
        localPhase = snapshotActive && snapshotActive.id === o.localCoin ? 'playerAim' : 'onlineWait';
      }
      if (localPhase === 'playerAim' && !localCoin?.alive) localPhase = 'onlineWait';
      G.phase = localPhase;
      if (localPhase === 'playerAim') {
        if (turnChanged) {
          o.lastTurn = snapshot.turn;
          o.shotSent = false;
          o.anchorSent = false;
          G.aim.charging = false;
          G.aim.power = 0;
          G.aim.chargeT = 0;
          G.dangerNotified = false;
          if (localCoin) G.aim.angle = Math.atan2(-localCoin.y, -localCoin.x);
          audio.turn();
          if (activeCoin) addWave(activeCoin.x, activeCoin.y, 58, rgba(activeCoin.color, 0.45), 0.4, 1.4);
        }
      } else {
        if (G.aim.charging) audio.stopCharge();
        G.aim.charging = false;
        G.aim.power = 0;
        G.aim.chargeT = 0;
      }
    }
    if (turnChanged) {
      o.lastTurn = snapshot.turn;
      ensureActiveVisible();
    }
    updateHUD(true);
    updateRoster();
  }

  function applyOnlineResult(payload) {
    if (!G.online || G.online.role !== 'guest' || G.online.resultReceived) return;
    const o = G.online;
    o.resultReceived = true;
    o.shotSent = false;
    const localCoin = G.coins.find((coin) => coin.id === o.localCoin);
    G.winnerId = payload.winnerId || null;
    G.playerOut = G.winnerId ? G.winnerId !== o.localCoin : (!localCoin || !localCoin.alive);
    if (payload.stats) {
      G.stats = { ...G.stats, ...payload.stats };
      G.stats.matchTime = payload.stats.matchTime || payload.stats.elapsed || G.stats.matchTime;
    }
    G.pending = null;
    G.phase = 'over';
    G.aim.charging = false;
    G.aim.power = 0;
    audio.stopCharge();
    const win = G.winnerId === o.localCoin;
    finishGame(win ? 'win' : 'defeat');
  }

  function handleOnlineEvent(payload) {
    if (!G.online || !payload) return;
    switch (payload.type) {
      case 'hello':
        G.online.connected = true;
        if (Number.isInteger(payload.slot)) G.online.selfSlot = payload.slot;
        if (payload.room) onlineRenderRoom(payload.room);
        break;
      case 'room-reset':
        if (payload.room) {
          G.online.room = payload.room;
          G.online.slots = payload.room.slots;
          G.online.mode = payload.room.mode || G.online.mode;
          G.online.roomArena = payload.room.arena || G.online.roomArena;
          if (G.phase !== 'over') onlineRenderRoom(payload.room);
        }
        break;
      case 'room-updated':
        if (payload.room) onlineRenderRoom(payload.room);
        break;
      case 'peer-connected':
        if (payload.room) onlineRenderRoom(payload.room);
        if (G.online.active && payload.slot?.type === 'guest') G.online.peerConnected = true;
        break;
      case 'player-left':
        if (G.online.active) {
          onlinePeerLeft(payload.slot?.name);
        } else if (payload.room) {
          onlineRenderRoom(payload.room);
        }
        break;
      case 'peer-left':
        if (G.online.active) onlinePeerLeft();
        else if (payload.room) onlineRenderRoom(payload.room);
        break;
      case 'start':
        if (G.online.role === 'guest' && payload.config) startGuestOnline(payload.config);
        break;
      case 'shot':
        if (G.online.role === 'host' && G.online.active) applyRemoteShot(payload);
        break;
      case 'lock':
        if (G.online.role === 'host' && G.online.active) applyRemoteLock(payload);
        break;
      case 'skill':
        if (G.online.role === 'host' && G.online.active) {
          if (payload.action === 'anchor') applyRemoteAnchor(payload);
          else applyRemoteEcho(payload);
        }
        break;
      case 'curve':
        if (G.online.role === 'host' && G.online.active) {
          const coin = G.coins.find((item) => item.id === payload.coin);
          if (coin) {
            coin.remoteCurveRight = !!payload.right;
            coin.remoteCurveLeft = !!payload.left;
          }
        }
        break;
      case 'snapshot':
        if (G.online.role === 'guest' && payload.snapshot) applyOnlineSnapshot(payload.snapshot);
        break;
      case 'result':
        if (G.online.role === 'guest') applyOnlineResult(payload);
        break;
      case 'rematch':
        if (G.online.role === 'guest' && payload.config) {
          closeResult(true);
          G.online.resultReceived = false;
          startGuestOnline(payload.config);
        }
        break;
      case 'room-closed':
        if (G.online.active) {
          onlinePeerLeft();
        } else {
          onlineSetError('房间已关闭。');
          clearOnlineSessionOnly();
          showOnlinePane('entry');
        }
        break;
      default:
        break;
    }
  }

  function applyRemoteLock(payload) {
    if (!G.online || G.online.role !== 'host' || G.phase !== 'volleyAim' || !G.volley) return;
    if (G.online.timer && G.online.timer.remaining <= 0) return;
    if (G.volley.firing) return;
    const coin = G.coins.find((item) => item.id === payload.coin && item.alive);
    if (!coin || coin.locked) return;
    if ((G.online.controllers[coin.id] || 'ai') !== 'guest') return;
    if (G.online.slotByCoin && Number(payload.slot) !== G.online.slotByCoin[coin.id]) return;
    const power = clamp(Number(payload.power) || 0, 0.04, 1);
    coin.volleyPlan = {
      angle: Number(payload.angle) || 0,
      power,
      target: null,
    };
    coin.locked = true;
    coin.volleySkipped = false;
    G.volley.locked += 1;
    coin.flash = Math.max(coin.flash || 0, 0.5);
    addWave(coin.x, coin.y, coin.radius + 16, rgba(coin.color, 0.5), 0.3, 1.2, false);
    updateRoster();
    updateHUD(true);
    maybeStartVolleyFire();
  }

  function applyRemoteShot(payload) {
    if (!G.online || G.online.role !== 'host' || G.phase !== 'onlineWait') return;
    if (G.online.timer && G.online.timer.remaining <= 0) return;
    const coin = G.coins.find((item) => item.id === payload.coin && item.alive);
    if (!coin || !G.active || G.active.id !== coin.id) return;
    if ((G.online.controllers[coin.id] || 'ai') !== 'guest') return;
    if (G.online.slotByCoin && Number(payload.slot) !== G.online.slotByCoin[coin.id]) return;
    const angle = Number(payload.angle) || 0;
    const power = clamp(Number(payload.power) || 0, 0.04, 1);
    addToast(`${payload.name || '对手'} 发射`, 'info', 1000);
    fireCoin(coin, angle, power);
  }

  function onlinePeerLeft(name) {
    if (!G.online || G.online.peerLeftNotice) return;
    G.online.peerLeftNotice = true;
    stopOnlineSnapshots();
    addToast(`${name || '有玩家'}已离开，联机对局结束`, 'out', 2800);
    setTimeout(() => {
      if (G.online) onlineLeaveGame(true);
    }, 1500);
  }

  async function onlineRematch() {
    if (!G.online || G.online.role !== 'host' || !G.online.active) return;
    if (!G.online.config) return;
    const hasGuests = Object.values(G.online.controllers || {}).includes('guest');
    if (hasGuests && !G.online.peerConnected) {
      addToast('玩家已离线，无法重开', 'out', 2200);
      return;
    }
    const config = G.online.config;
    closeResult(true);
    G.online.resultSent = false;
    G.online.resultReceived = false;
    await sendOnlineAction('rematch', { config });
    startHostOnline(config);
  }

  function onlineLeaveGame(sendLeave = true) {
    if (!G.online) return;
    shutdownOnlineSession(sendLeave);
    returnToMenu();
  }

  async function returnToOnlineRoom() {
    if (!G.online || !G.online.active) return;
    stopOnlineSnapshots();
    clearOnlineShotTimer();
    const session = G.online;
    session.active = false;
    session.started = false;
    session.resultSent = false;
    session.resultReceived = false;
    session.shotSent = false;
    session.lockSentRound = 0;
    session.peerLeftNotice = false;
    if (session.room) session.room.phase = 'lobby';
    if (session.role === 'host') {
      await sendOnlineAction('return-room');
    }
    G.online = null;
    returnToMenu();
    G.online = session;
    openOnlineLobby();
  }

  function shutdownOnlineSession(sendLeave = true) {
    if (!G.online) return;
    const restore = G.online.restore;
    stopOnlineSnapshots();
    clearOnlineShotTimer();
    if (sendLeave) sendOnlineAction('leave');
    if (G.online.eventSource) {
      G.online.eventSource.close();
      G.online.eventSource = null;
    }
    G.online = null;
    hideOnlineLobbyUI();
    dom.onlineExitBtn.hidden = true;
    if (restore) {
      G.mode = restore.mode;
      G.matchSize = restore.matchSize;
      G.arena = {
        ...restore.arena,
        walls: sanitizeWalls(restore.arena.walls),
        shrink: 1,
      };
      updateArenaRadius();
      applyModeUI();
      applyMatchSizeUI();
      updateArenaUI();
      updateArenaHudLabel();
      saveArenaConfig();
    }
  }

  function clearOnlineSessionOnly() {
    if (G.online) {
      if (G.online.eventSource) G.online.eventSource.close();
      stopOnlineSnapshots();
    }
    G.online = null;
  }

  function applyPlayerSelection() {
    const def = getPlayerDef();
    if (dom.selectedCoinBtn) {
      dom.selectedCoinBtn.style.setProperty('--coin-color', def.color);
      dom.selectedCoinBtn.style.setProperty('--coin-rgb', def.rgb);
    }
    if (dom.selectedOrb) {
      dom.selectedOrb.style.setProperty('--coin-color', def.color);
      dom.selectedOrb.style.setProperty('--coin-rgb', def.rgb);
    }
    if (dom.selectedGlyph) dom.selectedGlyph.textContent = def.glyph;
    if (dom.selectedCoinName) dom.selectedCoinName.textContent = def.name;
    if (dom.selectedCoinRole) dom.selectedCoinRole.textContent = `${def.role} · ${def.roleEn}`;
    if (dom.selectedSkillName) dom.selectedSkillName.textContent = def.skill.name;
    if (dom.selectedSkillShort) dom.selectedSkillShort.textContent = def.skill.short;
    if (dom.selectedCoinBtn) {
      dom.selectedCoinBtn.setAttribute('aria-label', `当前硬币${def.name}，打开硬币图鉴更换`);
    }
    const startLabel = dom.startBtn.querySelector('span');
    if (startLabel) startLabel.textContent = `以${def.name}出战`;
    dom.startBtn.setAttribute('aria-label', `以${def.name}开始对局`);
    if (dom.menuTipText) dom.menuTipText.textContent = PLAYER_TIPS[G.playerId] || PLAYER_TIPS.gold;
    if (dom.menuTip) {
      dom.menuTip.style.setProperty('--tip-rgb', def.rgb);
      dom.menuTip.style.setProperty('--tip-color', def.color);
    }
    if (dom.codexName) updateCodexDetail(G.codexOpen ? G.codexPreviewId : G.playerId);
  }

  function applyDifficultyUI() {
    const difficulty = getAIDifficulty();
    dom.difficultyButtons.forEach((btn) => {
      const active = btn.dataset.difficulty === G.difficulty;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    if (dom.difficultyNote) {
      dom.difficultyNote.textContent = difficulty.note;
      dom.difficultyNote.classList.toggle('is-hard', G.difficulty === 'hard');
    }
    applyPersonalityPoolUI();
  }

  function sanitizePersonalityPool(pool) {
    const valid = AI_PERSONALITIES.map((personality) => personality.id);
    const selected = Array.isArray(pool)
      ? valid.filter((id) => pool.includes(id))
      : valid.slice();
    return selected.length ? selected : valid.slice();
  }

  function personalityPoolSummaryText(pool) {
    const selected = sanitizePersonalityPool(pool);
    if (selected.length === AI_PERSONALITIES.length) return `全部 ${AI_PERSONALITIES.length} 种`;
    if (selected.length === 1) {
      return AI_PERSONALITIES.find((personality) => personality.id === selected[0]).name;
    }
    return `已启用 ${selected.length} 种`;
  }

  function applyPersonalityPoolUI() {
    G.personalityPool = sanitizePersonalityPool(G.personalityPool);
    const count = G.personalityPool.length;
    if (dom.personalityPoolSummary) {
      dom.personalityPoolSummary.textContent = personalityPoolSummaryText(G.personalityPool);
    }
    if (dom.personalityPoolNote) {
      dom.personalityPoolNote.textContent = count === AI_PERSONALITIES.length
        ? '每名 AI 从全部性格中随机获得，允许重复。'
        : `本局 AI 只会从已启用的 ${count} 种性格中随机获得，允许重复。`;
    }
  }

  function renderPersonalityPoolList() {
    if (!dom.personalityPoolList) return;
    const selected = new Set(G.personalityPool);
    dom.personalityPoolList.innerHTML = AI_PERSONALITIES.map((personality) => `
      <button class="pool-option${selected.has(personality.id) ? ' is-selected' : ''}"
        type="button" data-personality="${personality.id}"
        aria-pressed="${selected.has(personality.id)}"
        style="--pool-color:${personality.color}">
        <span class="pool-check" aria-hidden="true">✓</span>
        <span class="pool-copy"><strong>${personality.name}</strong><small>${personality.desc}</small></span>
      </button>
    `).join('');
  }

  function openPersonalityPool() {
    const onlineHost = !!(G.onlineLobbyOpen && G.online
      && G.online.role === 'host' && !G.online.active);
    if (G.phase !== 'menu' || G.personalityPoolOpen) return;
    if (G.onlineLobbyOpen && !onlineHost) return;
    audio.init();
    audio.ui();
    closeHelp(true);
    closeArena(true);
    closeCodex(true);
    G.personalityPoolOpen = true;
    if (G.onlineLobbyOpen) dom.onlineScreen.inert = true;
    else dom.menu.inert = true;
    applyPersonalityPoolUI();
    renderPersonalityPoolList();
    dom.personalityPool.classList.add('is-open');
    dom.personalityPool.setAttribute('aria-hidden', 'false');
    setTimeout(() => {
      if (G.personalityPoolOpen) dom.personalityPoolClose.focus({ preventScroll: true });
    }, 120);
  }

  function closePersonalityPool(immediate = false) {
    if (!G.personalityPoolOpen && !immediate) return;
    G.personalityPoolOpen = false;
    dom.personalityPool.classList.remove('is-open');
    dom.personalityPool.setAttribute('aria-hidden', 'true');
    if (G.onlineLobbyOpen) {
      if (dom.onlineScreen) dom.onlineScreen.inert = false;
    } else if (G.phase === 'menu') {
      dom.menu.inert = false;
    }
    if (!immediate) {
      audio.ui();
      const focusTarget = G.onlineLobbyOpen ? dom.onlinePoolBtn : dom.personalityPoolBtn;
      if (focusTarget) focusTarget.focus({ preventScroll: true });
    }
  }

  function syncOnlinePersonalityPool() {
    if (!G.online || G.online.role !== 'host' || G.online.active || !G.onlineLobbyOpen) return;
    if (!G.online.code) return;
    sendOnlineAction('setting', { personalityPool: G.personalityPool }).catch(() => {});
  }

  function togglePersonality(id) {
    if (!AI_PERSONALITIES.some((personality) => personality.id === id)) return;
    const selected = G.personalityPool.includes(id);
    if (selected && G.personalityPool.length <= 1) {
      if (dom.personalityPoolList) {
        dom.personalityPoolList.animate(
          [{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }],
          { duration: 180, easing: 'ease-out' },
        );
      }
      return;
    }
    G.personalityPool = selected
      ? G.personalityPool.filter((item) => item !== id)
      : [...G.personalityPool, id];
    G.personalityPool = sanitizePersonalityPool(G.personalityPool);
    safeStorageSet('edgecoin.personalityPool', JSON.stringify(G.personalityPool));
    applyPersonalityPoolUI();
    renderPersonalityPoolList();
    audio.init();
    audio.ui();
    syncOnlinePersonalityPool();
  }

  function selectAllPersonalities() {
    G.personalityPool = AI_PERSONALITIES.map((personality) => personality.id);
    safeStorageSet('edgecoin.personalityPool', JSON.stringify(G.personalityPool));
    applyPersonalityPoolUI();
    renderPersonalityPoolList();
    audio.ui();
    syncOnlinePersonalityPool();
  }

  function selectDifficulty(id) {
    if (!AI_DIFFICULTIES[id] || id === G.difficulty) return;
    audio.init();
    audio.ui();
    G.difficulty = id;
    safeStorageSet('edgecoin.difficulty', id);
    applyDifficultyUI();
  }

  function getAIDifficulty() {
    return AI_DIFFICULTIES[G.difficulty] || AI_DIFFICULTIES.normal;
  }

  function selectPlayer(id) {
    if (!DEF_BY_ID[id] || id === G.playerId) return;
    audio.init();
    audio.ui();
    G.playerId = id;
    G.codexPreviewId = id;
    safeStorageSet('edgecoin.player', id);
    applyPlayerSelection();
    if (G.phase === 'menu') {
      G.coins = createCoins(true);
      G.active = null;
      G.activeIndex = -1;
      G.alive = G.coins.length;
      clearEffects();
      const chosen = G.coins.find((c) => c.id === id);
      if (chosen) {
        addWave(chosen.x, chosen.y, 104, rgba(chosen.color, 0.58), 0.68, 2.2);
        addSparks(chosen.x, chosen.y, 18, [chosen.color, '#fff2c9'], 240);
      }
      updateRoster();
      if (G.arenaOpen) drawArenaPreview();
    }
    if (G.onlineLobbyOpen) updateOnlineCoinPreview();
  }

  function isPlayerCoin(coin) {
    return !!coin && coin.id === G.playerId;
  }

  function isFirstShotProtected(coin) {
    return G.mode === 'turn'
      && G.phase !== 'menu'
      && G.phase !== 'over'
      && !!coin
      && coin.alive
      && !coin.hasFired;
  }

  function saveArenaConfig() {
    safeStorageSet('edgecoin.arena', JSON.stringify({
      shape: G.arena.shape,
      size: G.arena.size,
      walls: G.arena.walls,
      turnLimit: G.arena.turnLimit,
      shrinkRate: G.arena.shrinkRate,
      obstacles: sanitizeObstacleConfig(G.arena.obstacles),
    }));
  }

  function traceShapeAt(c, shape, cx, cy, radius) {
    c.beginPath();
    if (!shape.points) {
      c.arc(cx, cy, radius, 0, TAU);
      return;
    }
    shape.points.forEach(([px, py], index) => {
      const x = cx + px * radius;
      const y = cy + py * radius;
      if (index === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    });
    c.closePath();
  }

  function arenaHudLabelText() {
    const shape = getArenaShape();
    const sizePct = Math.round(G.arena.size * 100);
    const shrinkPct = Math.round((G.arena.shrink || 1) * 100);
    return `${shape.name} ${sizePct}%${shrinkPct < 100 ? ` · 收缩 ${shrinkPct}%` : ''}`;
  }

  function updateArenaHudLabel() {
    if (dom.arenaLabel) dom.arenaLabel.textContent = arenaHudLabelText();
  }

  function updateArenaUI() {
    const shape = getArenaShape();
    const pct = Math.round(G.arena.size * 100);
    dom.arenaShapeButtons.forEach((btn) => {
      const selected = btn.dataset.shape === G.arena.shape;
      btn.classList.toggle('is-selected', selected);
      btn.setAttribute('aria-pressed', String(selected));
    });
    if (dom.arenaSizeRange) {
      dom.arenaSizeRange.value = String(pct);
      dom.arenaSizeRange.style.setProperty('--fill', `${((pct - 70) / 230) * 100}%`);
    }
    if (dom.arenaSizeValue) dom.arenaSizeValue.textContent = `${pct}%`;
    if (dom.arenaBtnLabel) dom.arenaBtnLabel.textContent = `场地 · ${shape.name} ${pct}%`;
    if (dom.arenaBtn) dom.arenaBtn.setAttribute('aria-label', `场地设置：${shape.name} ${pct}%`);
    if (dom.arenaSummary) dom.arenaSummary.textContent = `${shape.name} · ${pct}%`;
    if (dom.arenaDescription) dom.arenaDescription.textContent = shape.desc;
    if (dom.arenaEdgeType) dom.arenaEdgeType.textContent = shape.edge;
    if (dom.arenaSpace) {
      dom.arenaSpace.textContent = pct <= 90 ? '紧凑' : (pct >= 115 ? '宽敞' : '标准');
    }
    updateWallControls();
    updateShrinkControls();
    updateObstacleControls();
    G.arenaObstaclePreview = null;
    drawArenaPreview();
  }

  function updateShrinkControls() {
    if (!dom.turnLimitRange || !dom.shrinkRateRange) return;
    const turnLimit = clamp(Math.round(Number(G.arena.turnLimit) || 0), 0, ARENA_MAX_TURN_LIMIT);
    const shrinkRate = clamp(
      Math.round(Number(G.arena.shrinkRate) || ARENA_DEFAULT_SHRINK_RATE),
      2,
      15,
    );
    G.arena.turnLimit = turnLimit;
    G.arena.shrinkRate = shrinkRate;
    dom.turnLimitRange.value = String(turnLimit);
    dom.shrinkRateRange.value = String(shrinkRate);
    dom.turnLimitRange.style.setProperty('--fill', `${(turnLimit / ARENA_MAX_TURN_LIMIT) * 100}%`);
    dom.shrinkRateRange.style.setProperty('--fill', `${((shrinkRate - 2) / 13) * 100}%`);
    dom.turnLimitValue.textContent = turnLimit > 0 ? `${turnLimit} 回合` : '不限';
    dom.shrinkRateValue.textContent = `${shrinkRate}%`;
    const disabled = turnLimit <= 0;
    dom.shrinkRateRange.disabled = disabled;
    if (dom.shrinkRateControl) dom.shrinkRateControl.classList.toggle('is-disabled', disabled);
    dom.shrinkHint.textContent = disabled
      ? '当前关闭：不限回合，也不会收缩。'
      : `第 ${turnLimit + 1} 回合起，每回合边界向内收缩 ${shrinkRate}%。`;
  }

  function updateWallControls() {
    if (!dom.wallGrid || !dom.wallHint) return;    const shape = getArenaShape();
    if (!shape.points) {
      dom.wallGrid.innerHTML = '';
      dom.wallGrid.dataset.shape = 'circle';
      dom.wallHint.textContent = '圆桌没有直边，全部边界保持开放。';
      dom.wallHint.classList.remove('is-warning');
      return;
    }
    const flags = getWallFlags();
    G.arena.walls[shape.id] = flags;
    const count = flags.length;
    if (dom.wallGrid.dataset.shape !== shape.id) {
      dom.wallGrid.innerHTML = '';
      dom.wallGrid.dataset.shape = shape.id;
      for (let i = 0; i < count; i += 1) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'wall-btn';
        btn.dataset.edgeIndex = String(i);
        btn.innerHTML = `<strong>边 ${i + 1}</strong><small>开放</small>`;
        dom.wallGrid.appendChild(btn);
      }
    }
    const buttons = Array.from(dom.wallGrid.querySelectorAll('.wall-btn'));
    const openCount = flags.filter((flag) => !flag).length;
    buttons.forEach((btn, index) => {
      const wall = !!flags[index];
      const lastOpen = !wall && openCount === 1;
      btn.classList.toggle('is-wall', wall);
      btn.classList.toggle('is-last-open', lastOpen);
      btn.setAttribute('aria-pressed', String(wall));
      btn.setAttribute(
        'aria-label',
        `边 ${index + 1}，${wall ? '墙壁' : (lastOpen ? '唯一开放边界' : '开放')}`,
      );
      const small = btn.querySelector('small');
      if (small) small.textContent = wall ? '墙壁' : (lastOpen ? '唯一出口' : '开放');
    });
    const wallCount = count - openCount;
    dom.wallHint.classList.remove('is-warning');
    dom.wallHint.textContent = wallCount > 0
      ? `已封闭 ${wallCount} 条边 · ${openCount} 条开放边界。撞墙会损失动能并反弹。`
      : '点击一条边将它变成墙壁；至少保留一条开放边。';
  }

  function updateObstacleControls() {
    if (!dom.obstacleCountRange) return;
    const config = sanitizeObstacleConfig(G.arena.obstacles);
    G.arena.obstacles = config;
    if (config.count > 0) G.obstacleLastCount = config.count;
    const enabled = config.count > 0;
    if (dom.obstacleEnabled) dom.obstacleEnabled.checked = enabled;
    if (dom.obstacleCustomPlacement) dom.obstacleCustomPlacement.disabled = !enabled;
    if (dom.obstacleSizeRange) dom.obstacleSizeRange.disabled = !enabled;
    if (dom.obstacleRotationRange) dom.obstacleRotationRange.disabled = !enabled;
    dom.obstacleCountRange.value = String(config.count);
    dom.obstacleCountRange.disabled = !enabled;
    dom.obstacleCountRange.style.setProperty('--fill', `${(config.count / OBSTACLE_MAX_COUNT) * 100}%`);
    if (dom.obstacleCountValue) dom.obstacleCountValue.textContent = String(config.count);
    dom.obstacleTypeButtons.forEach((button) => {
      const type = button.dataset.obstacleType;
      const selectedItem = config.placement === 'custom'
        ? config.items[Math.min(G.arenaObstacleSelected, Math.max(0, config.items.length - 1))]
        : null;
      const active = selectedItem ? selectedItem.type === type : (type === 'fixed' ? config.fixed : config.movable);
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
      button.disabled = !enabled;
    });
    dom.obstacleShapeButtons.forEach((button) => {
      const selectedItem = config.placement === 'custom'
        ? config.items[Math.min(G.arenaObstacleSelected, Math.max(0, config.items.length - 1))]
        : null;
      const active = selectedItem
        ? selectedItem.shape === button.dataset.obstacleShape
        : config.shapes.includes(button.dataset.obstacleShape);
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
      button.disabled = !enabled;
    });
    if (dom.obstacleSection) {
      dom.obstacleSection.hidden = G.mode === 'chase';
      dom.obstacleSection.querySelector('.obstacle-panel')?.classList.toggle('is-disabled', !enabled);
    }
    if (dom.obstacleHint) {
      if (config.count <= 0) {
        dom.obstacleHint.textContent = '已关闭障碍物：本局不会生成任何障碍物。';
      } else {
        const typeText = config.fixed && config.movable
          ? '固定 + 可推动'
          : (config.fixed ? '固定反弹' : '可推动');
        const shapeText = config.shapes.map((id) => OBSTACLE_SHAPES[id].name).join(' / ');
        dom.obstacleHint.textContent = config.placement === 'custom'
          ? `${config.count} 个障碍 · 已启用手动摆放；类型与形状按钮作用于选中的障碍物。`
          : `${config.count} 个障碍 · ${typeText} · ${shapeText}；位置在开局时随机生成。`;
      }
    }
    updateCustomObstaclePanel();
  }

  function commitObstacleConfig() {
    G.arena.obstacles = sanitizeObstacleConfig(G.arena.obstacles);
    saveArenaConfig();
    G.arenaObstaclePreview = null;
    updateArenaUI();
  }

  function createCustomObstacleItem(config, index) {
    const safe = sanitizeObstacleConfig(config);
    const types = [];
    if (safe.fixed) types.push('fixed');
    if (safe.movable) types.push('movable');
    const shapes = safe.shapes.length ? safe.shapes : ['circle'];
    const angle = Math.random() * TAU;
    const distance = 0.16 + Math.random() * 0.34;
    return {
      id: `custom-${index + 1}`,
      shape: shapes[Math.floor(Math.random() * shapes.length)],
      type: types[Math.floor(Math.random() * types.length)] || 'fixed',
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
      size: 5.5 + Math.random() * 4.5,
      rot: Math.random() * TAU,
    };
  }

  function ensureCustomObstacleItems(config) {
    const safe = sanitizeObstacleConfig(config);
    if (safe.placement !== 'custom') return safe;
    const targetCount = Math.max(1, Math.min(OBSTACLE_MAX_COUNT, safe.count || 4));
    const items = safe.items.slice();
    while (items.length < targetCount) {
      items.push(createCustomObstacleItem({ ...safe, items: [] }, items.length));
    }
    while (items.length > targetCount) items.pop();
    return sanitizeObstacleConfig({ ...safe, count: items.length, items });
  }

  function syncCustomObstacleCount(config, count) {
    const safe = sanitizeObstacleConfig(config);
    const target = clamp(Math.round(Number(count) || 0), 0, OBSTACLE_MAX_COUNT);
    let items = safe.items.slice();
    while (items.length < target) {
      items.push(createCustomObstacleItem(safe, items.length));
    }
    if (target > 0) items = items.slice(0, target);
    return sanitizeObstacleConfig({
      ...safe,
      count: target,
      placement: 'custom',
      items,
    });
  }

  function updateCustomObstaclePanel() {
    const config = sanitizeObstacleConfig(G.arena.obstacles);
    const custom = config.placement === 'custom';
    if (dom.obstacleCustomPlacement) {
      dom.obstacleCustomPlacement.checked = custom;
    }
    if (dom.obstacleCustomPanel) dom.obstacleCustomPanel.hidden = !custom || config.count <= 0 || config.items.length === 0;
    if (dom.arenaPreview) dom.arenaPreview.classList.toggle('is-custom', custom);
    if (!custom || !config.items.length) return;
    if (G.arenaObstacleSelected >= config.items.length) G.arenaObstacleSelected = config.items.length - 1;
    if (G.arenaObstacleSelected < 0) G.arenaObstacleSelected = 0;
    const item = config.items[G.arenaObstacleSelected];
    if (dom.obstacleSizeRange) dom.obstacleSizeRange.value = String(item.size);
    if (dom.obstacleSizeRange) dom.obstacleSizeRange.style.setProperty('--fill', `${((item.size - 2.5) / 15.5) * 100}%`);
    if (dom.obstacleSizeValue) dom.obstacleSizeValue.textContent = `${item.size.toFixed(1)}%`;
    const degrees = ((item.rot * 180 / Math.PI) % 360 + 360) % 360;
    if (dom.obstacleRotationRange) {
      dom.obstacleRotationRange.value = String(Math.round(degrees));
      dom.obstacleRotationRange.style.setProperty('--fill', `${(degrees / 360) * 100}%`);
    }
    if (dom.obstacleRotationValue) dom.obstacleRotationValue.textContent = `${Math.round(degrees)}°`;
    if (dom.obstacleCustomHint) {
      dom.obstacleCustomHint.textContent = `已选中第 ${G.arenaObstacleSelected + 1} 个障碍物 · 拖动预览移动 · 滑杆调整大小与旋转`;
    }
  }

  function toggleObstacleType(type) {
    const config = sanitizeObstacleConfig(G.arena.obstacles);
    if (config.placement === 'custom' && config.items.length) {
      const index = clamp(G.arenaObstacleSelected, 0, config.items.length - 1);
      const items = config.items.map((item, itemIndex) => itemIndex === index
        ? { ...item, type: type === 'movable' ? 'movable' : 'fixed' }
        : item);
      G.arena.obstacles = sanitizeObstacleConfig({ ...config, items });
      audio.init();
      audio.ui();
      commitObstacleConfig();
      return;
    }
    const next = { ...config, fixed: config.fixed, movable: config.movable };
    if (type === 'fixed') next.fixed = !next.fixed;
    else next.movable = !next.movable;
    if (!next.fixed && !next.movable) {
      if (dom.obstacleHint) dom.obstacleHint.textContent = '至少保留一种障碍物类型。';
      return;
    }
    G.arena.obstacles = sanitizeObstacleConfig(next);
    audio.init();
    audio.ui();
    commitObstacleConfig();
  }

  function toggleObstacleShape(shapeId) {
    if (!OBSTACLE_SHAPES[shapeId]) return;
    const config = sanitizeObstacleConfig(G.arena.obstacles);
    if (config.placement === 'custom' && config.items.length) {
      const index = clamp(G.arenaObstacleSelected, 0, config.items.length - 1);
      const items = config.items.map((item, itemIndex) => itemIndex === index
        ? { ...item, shape: shapeId }
        : item);
      G.arena.obstacles = sanitizeObstacleConfig({ ...config, items });
      audio.init();
      audio.ui();
      commitObstacleConfig();
      return;
    }
    const shapes = config.shapes.includes(shapeId)
      ? config.shapes.filter((id) => id !== shapeId)
      : [...config.shapes, shapeId];
    if (!shapes.length) {
      if (dom.obstacleHint) dom.obstacleHint.textContent = '至少保留一种障碍物形状。';
      return;
    }
    G.arena.obstacles = sanitizeObstacleConfig({ ...config, shapes });
    audio.init();
    audio.ui();
    commitObstacleConfig();
  }

  function toggleWall(index) {
    const shape = getArenaShape();
    if (!shape.points) return;
    const flags = getWallFlags();
    if (!flags[index] && flags.filter((flag) => !flag).length <= 1) {
      dom.wallHint.textContent = '至少保留一条开放边界，不能封闭最后出口。';
      dom.wallHint.classList.add('is-warning');
      dom.wallGrid.animate(
        [{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }],
        { duration: 180, easing: 'ease-out' },
      );
      return;
    }
    flags[index] = !flags[index];
    G.arena.walls[shape.id] = flags;
    audio.init();
    audio.ui();
    saveArenaConfig();
    updateArenaUI();
  }

  function drawArenaPreview() {
    if (!previewCtx) return;
    const canvas = dom.arenaPreview;
    const w = canvas.width;
    const h = canvas.height;
    previewCtx.setTransform(1, 0, 0, 1, 0, 0);
    previewCtx.clearRect(0, 0, w, h);

    const bg = previewCtx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0a1a1d');
    bg.addColorStop(1, '#040b0d');
    previewCtx.fillStyle = bg;
    previewCtx.fillRect(0, 0, w, h);

    previewCtx.strokeStyle = 'rgba(147, 225, 213, 0.045)';
    previewCtx.lineWidth = 1;
    for (let x = 20; x < w; x += 32) {
      previewCtx.beginPath();
      previewCtx.moveTo(x, 0);
      previewCtx.lineTo(x, h);
      previewCtx.stroke();
    }
    for (let y = 20; y < h; y += 32) {
      previewCtx.beginPath();
      previewCtx.moveTo(0, y);
      previewCtx.lineTo(w, y);
      previewCtx.stroke();
    }

    const shape = getArenaShape();
    const cx = w / 2;
    const cy = h / 2 - 2;
    const radius = arenaPreviewRadius();

    previewCtx.save();
    traceShapeAt(previewCtx, shape, cx, cy, radius);
    previewCtx.fillStyle = 'rgba(2, 8, 9, 0.75)';
    previewCtx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    previewCtx.shadowBlur = 30;
    previewCtx.fill();
    previewCtx.restore();

    previewCtx.save();
    traceShapeAt(previewCtx, shape, cx, cy, radius);
    const fill = previewCtx.createRadialGradient(cx - radius * 0.24, cy - radius * 0.3, radius * 0.08, cx, cy, radius * 1.05);
    fill.addColorStop(0, '#13383b');
    fill.addColorStop(0.55, '#0b2225');
    fill.addColorStop(1, '#061114');
    previewCtx.fillStyle = fill;
    previewCtx.fill();
    previewCtx.clip();

    previewCtx.strokeStyle = 'rgba(123, 239, 222, 0.12)';
    previewCtx.lineWidth = 1;
    for (let r = radius * 0.24; r < radius; r += radius * 0.18) {
      previewCtx.beginPath();
      previewCtx.arc(cx, cy, r, 0, TAU);
      previewCtx.stroke();
    }
    previewCtx.strokeStyle = 'rgba(123, 239, 222, 0.055)';
    for (let i = 0; i < 8; i += 1) {
      const a = i / 8 * TAU;
      previewCtx.beginPath();
      previewCtx.moveTo(cx, cy);
      previewCtx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
      previewCtx.stroke();
    }
    previewCtx.restore();

    previewCtx.save();
    traceShapeAt(previewCtx, shape, cx, cy, radius);
    previewCtx.strokeStyle = 'rgba(80, 231, 212, 0.16)';
    previewCtx.lineWidth = 12;
    previewCtx.shadowColor = 'rgba(80, 231, 212, 0.32)';
    previewCtx.shadowBlur = 22;
    previewCtx.stroke();
    previewCtx.shadowBlur = 0;
    traceShapeAt(previewCtx, shape, cx, cy, radius);
    previewCtx.strokeStyle = 'rgba(174, 255, 244, 0.72)';
    previewCtx.lineWidth = 2;
    previewCtx.stroke();
    previewCtx.restore();

    if (shape.points) {
      const flags = getWallFlags();
      const points = shape.points.map(([px, py]) => ({ x: cx + px * radius, y: cy + py * radius }));
      flags.forEach((wall, index) => {
        if (!wall) return;
        const a = points[index];
        const b = points[(index + 1) % points.length];
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const len = Math.hypot(ex, ey) || 1;
        let nx = -ey / len;
        let ny = ex / len;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        if (nx * (mx - cx) + ny * (my - cy) < 0) {
          nx = -nx;
          ny = -ny;
        }
        previewCtx.save();
        previewCtx.lineCap = 'round';
        previewCtx.strokeStyle = 'rgba(255, 209, 102, 0.28)';
        previewCtx.lineWidth = 11;
        previewCtx.shadowColor = 'rgba(255, 190, 80, 0.55)';
        previewCtx.shadowBlur = 16;
        previewCtx.beginPath();
        previewCtx.moveTo(a.x, a.y);
        previewCtx.lineTo(b.x, b.y);
        previewCtx.stroke();
        previewCtx.shadowBlur = 0;
        previewCtx.strokeStyle = 'rgba(255, 236, 185, 0.92)';
        previewCtx.lineWidth = 2.2;
        previewCtx.beginPath();
        previewCtx.moveTo(a.x, a.y);
        previewCtx.lineTo(b.x, b.y);
        previewCtx.stroke();
        previewCtx.strokeStyle = 'rgba(255, 220, 150, 0.34)';
        previewCtx.lineWidth = 1;
        for (let d = 8; d < len; d += 14) {
          const px = a.x + (ex / len) * d;
          const py = a.y + (ey / len) * d;
          previewCtx.beginPath();
          previewCtx.moveTo(px - nx * 2, py - ny * 2);
          previewCtx.lineTo(px - nx * 8, py - ny * 8);
          previewCtx.stroke();
        }
        previewCtx.restore();
      });
    }

    drawObstaclePreview(cx, cy, radius);

    const seatOrder = previewParticipantIds();
    const seatAngles = seatOrder.map((_, index) => Math.PI / 2 + (index / seatOrder.length) * TAU);
    const seatRadius = radius * 0.635;
    seatOrder.forEach((id, index) => {
      const def = participantDef(id);
      const a = seatAngles[index];
      const x = cx + Math.cos(a) * seatRadius;
      const y = cy + Math.sin(a) * seatRadius;
      const isPlayer = id === G.playerId;
      previewCtx.save();
      previewCtx.fillStyle = def.color;
      previewCtx.shadowColor = def.color;
      previewCtx.shadowBlur = isPlayer ? 18 : 10;
      previewCtx.beginPath();
      previewCtx.arc(x, y, isPlayer ? 9 : 7, 0, TAU);
      previewCtx.fill();
      previewCtx.shadowBlur = 0;
      previewCtx.strokeStyle = 'rgba(3, 10, 11, 0.9)';
      previewCtx.lineWidth = 2.5;
      previewCtx.beginPath();
      previewCtx.arc(x, y, isPlayer ? 11 : 9, 0, TAU);
      previewCtx.stroke();
      previewCtx.restore();
      if (isPlayer) {
        previewCtx.save();
        previewCtx.strokeStyle = rgba(def.color, 0.7);
        previewCtx.lineWidth = 1.2;
        previewCtx.setLineDash([4, 6]);
        previewCtx.beginPath();
        previewCtx.arc(x, y, 19, 0, TAU);
        previewCtx.stroke();
        previewCtx.setLineDash([]);
        previewCtx.font = '600 11px "Segoe UI", "Microsoft YaHei UI", sans-serif';
        previewCtx.fillStyle = rgba(def.color, 0.9);
        previewCtx.textAlign = 'center';
        previewCtx.fillText('你', x, Math.min(h - 8, y + 34));
        previewCtx.restore();
      }
    });

    previewCtx.save();
    previewCtx.fillStyle = 'rgba(198, 236, 228, 0.26)';
    previewCtx.font = '500 10px "Cascadia Mono", monospace';
    previewCtx.textAlign = 'left';
    previewCtx.fillText(`${shape.en} / ${Math.round(G.arena.size * 100)}%`, 18, 28);
    previewCtx.restore();
  }

  function applyArenaConfig(shapeId, size, options = {}) {
    if (!Object.prototype.hasOwnProperty.call(ARENA_SHAPES, shapeId)) return;
    const nextSize = clamp(Math.round((Number(size) || 1) * 20) / 20, ARENA_MIN_SIZE, ARENA_MAX_SIZE);
    const changed = shapeId !== G.arena.shape || nextSize !== G.arena.size;
    G.arena.shape = shapeId;
    G.arena.size = nextSize;
    G.arena.shrink = 1;
    updateArenaRadius();
    saveArenaConfig();

    if (G.phase === 'menu') {
      G.zoomAdjusted = false;
      updateProjection();
      const cam = G.camera;
      cam.userPanned = false;
      cam.zoom = G.baseZoom;
      cam.tzoom = G.baseZoom;
      cam.x = cam.homeX;
      cam.y = cam.homeY;
      cam.tx = cam.homeX;
      cam.ty = cam.homeY;
      cam.shake = 0;
      initAmbient();
      G.coins = createCoins(true);
      G.active = null;
      G.activeIndex = -1;
      G.alive = G.coins.length;
      updateRoster();
      if (changed && options.effects) {
        clearEffects();
        addWave(0, 0, R * 0.82, 'rgba(80,231,212,0.30)', 0.8, 1.8);
      }
    }
    updateArenaUI();
    updateZoomLabel();
  }

  function renderInspectList() {
    if (!dom.inspectList) return;
    dom.inspect.classList.toggle('is-volley', G.mode === 'volley');
    dom.inspectList.innerHTML = '';
    G.coins.forEach((coin, index) => {
      const def = coin.def;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'codex-item inspect-item';
      btn.dataset.coin = coin.id;
      btn.setAttribute('role', 'option');
      btn.style.setProperty('--coin-color', def.color);
      btn.style.setProperty('--coin-rgb', def.rgb);
      btn.classList.toggle('is-out', !coin.alive);
      btn.classList.toggle('is-active-item', coin === G.active && coin.alive);
      btn.innerHTML = `
        <span class="codex-item-orb" aria-hidden="true">${def.glyph}</span>
        <span class="codex-item-name">
          <strong>${isPlayerCoin(coin) ? `${def.name}<em class="inspect-you">YOU</em>` : def.name}</strong>
          <small>${def.role}</small>
        </span>
        <span class="inspect-item-order">${String(index + 1).padStart(2, '0')}</span>
      `;
      btn.addEventListener('click', () => {
        G.inspectCoinId = coin.id;
        audio.init();
        audio.ui();
        updateInspectDetail(coin.id);
      });
      dom.inspectList.appendChild(btn);
    });
  }

  function updateInspectDetail(id) {
    if (!dom.inspectName || !G.coins.length) return;
    const index = Math.max(0, G.coins.findIndex((c) => c.id === id));
    const coin = G.coins[index] || G.coins[0];
    const def = coin.def;
    G.inspectCoinId = coin.id;
    dom.inspectOrb.style.setProperty('--coin-color', def.color);
    dom.inspectOrb.style.setProperty('--coin-rgb', def.rgb);
    dom.inspectGlyph.textContent = def.glyph;
    dom.inspectRole.textContent = `${def.role} · ${def.roleEn}`;
    dom.inspectName.textContent = def.name;
    dom.inspectTagline.textContent = `${def.skill.short}。`;
    dom.inspectSkillName.textContent = def.skill.name;
    dom.inspectSkillTag.textContent = def.skill.tag;
    dom.inspectSkillDesc.textContent = def.skill.desc;
    dom.inspectMass.textContent = def.mass.toFixed(2);
    dom.inspectSpeed.textContent = String(def.launchMax);
    if (G.mode === 'volley') {
      dom.inspectOrderLabel.textContent = '发射方式';
      dom.inspectOrder.textContent = '同时';
    } else {
      dom.inspectOrderLabel.textContent = '本局顺序';
      dom.inspectOrder.textContent = String(index + 1).padStart(2, '0');
    }
    dom.inspectTip.textContent = def.skill.tip;

    let status = '存活';
    let statusClass = '';
    if (!coin.alive) {
      status = '已出局';
      statusClass = 'is-out';
    } else if (isFirstShotProtected(coin)) {
      status = '首发保护';
      statusClass = 'is-protected';
    } else if (G.mode === 'volley' && G.phase === 'volleyAim') {
      status = coin.locked ? '已锁定' : (coin.id === G.playerId ? '瞄准中' : '准备中');
      statusClass = coin.locked || coin.id === G.playerId ? 'is-active' : '';
    } else if (G.mode === 'volley' && G.phase === 'resolve') {
      status = '滑行中';
      statusClass = 'is-active';
    } else if (coin === G.active) {
      status = G.phase === 'resolve' ? '滑行中' : '行动中';
      statusClass = 'is-active';
    }
    dom.inspectStatus.textContent = status;
    dom.inspectStatus.classList.remove('is-out', 'is-active', 'is-protected');
    if (statusClass) dom.inspectStatus.classList.add(statusClass);

    Array.from(dom.inspectList.querySelectorAll('.inspect-item')).forEach((btn) => {
      const selected = btn.dataset.coin === coin.id;
      const player = btn.dataset.coin === G.playerId;
      btn.classList.toggle('is-preview', selected);
      btn.classList.toggle('is-current', player);
      btn.setAttribute('aria-selected', String(selected));
    });
  }

  function openInspect(coinId) {
    if (G.online && G.online.active) {
      addToast('联机对局中不能暂停查看硬币', 'info', 1800);
      return;
    }
    if (G.phase === 'menu' || G.phase === 'over' || G.phase === 'pending') return;
    if (G.helpOpen || G.codexOpen || G.arenaOpen || G.resultOpen || G.inspectOpen) return;
    if (!G.coins.length) return;
    const validId = G.coins.some((c) => c.id === coinId) ? coinId : null;
    G.inspectOpen = true;
    G.inspectCoinId = validId || (G.active ? G.active.id : G.playerId);
    clearPanKeys();
    cancelCharge();
    audio.stopCharge();
    G.pointer.down = false;
    dom.hud.inert = true;
    renderInspectList();
    updateInspectDetail(G.inspectCoinId);
    dom.inspect.classList.add('is-open');
    dom.inspect.setAttribute('aria-hidden', 'false');
    setTimeout(() => {
      if (G.inspectOpen) dom.inspectClose.focus({ preventScroll: true });
    }, 100);
  }

  function closeInspect(immediate = false) {
    if (!G.inspectOpen && !immediate) return;
    G.inspectOpen = false;
    dom.inspect.classList.remove('is-open');
    dom.inspect.setAttribute('aria-hidden', 'true');
    if (!G.resultOpen && !G.helpOpen) dom.hud.inert = false;
    if (!immediate) {
      audio.ui();
      dom.rosterInspectBtn.focus({ preventScroll: true });
    }
  }

  function openCodex() {
    if (G.phase !== 'menu') return;
    audio.init();
    audio.ui();
    clearPanKeys();
    closeHelp(true);
    closeArena(true);
    G.codexOpen = true;
    G.codexPreviewId = G.playerId;
    dom.menu.inert = true;
    updateCodexDetail(G.codexPreviewId);
    dom.codex.classList.add('is-open');
    dom.codex.setAttribute('aria-hidden', 'false');
    setTimeout(() => {
      if (G.codexOpen) dom.codexClose.focus({ preventScroll: true });
    }, 120);
  }

  function closeCodex(immediate = false) {
    if (!G.codexOpen && !immediate) return;
    G.codexOpen = false;
    dom.codex.classList.remove('is-open');
    dom.codex.setAttribute('aria-hidden', 'true');
    if (G.phase === 'menu') dom.menu.inert = false;
    if (!immediate) {
      audio.ui();
      dom.selectedCoinBtn.focus({ preventScroll: true });
    }
  }

  function openArena() {
    if (G.phase !== 'menu') return;
    if (G.mode === 'chase') {
      addToast('追击模式使用固定的圆形迷宫', 'info', 2000);
      return;
    }
    if (G.codexOpen) closeCodex(true);
    audio.init();
    audio.ui();
    clearPanKeys();
    closeHelp(true);
    G.arenaOpen = true;
    dom.menu.inert = true;
    updateArenaUI();
    dom.arena.classList.add('is-open');
    dom.arena.setAttribute('aria-hidden', 'false');
    setTimeout(() => {
      if (G.arenaOpen) dom.arenaClose.focus({ preventScroll: true });
    }, 120);
  }

  function openOnlineArenaEditor() {
    if (!G.online || G.online.role !== 'host' || G.online.active || G.onlineArenaEditing) return;
    G.onlineArenaEditing = true;
    hideOnlineLobbyUI();
    openArena();
  }

  function closeArena(immediate = false) {
    if (!G.arenaOpen && !immediate) return;
    G.arenaOpen = false;
    dom.arena.classList.remove('is-open');
    dom.arena.setAttribute('aria-hidden', 'true');
    if (G.phase === 'menu') dom.menu.inert = false;
    if (G.onlineArenaEditing) {
      G.onlineArenaEditing = false;
      if (G.online && !G.online.active) {
        const arena = onlineArenaConfig();
        G.online.roomArena = arena;
        if (G.online.room) G.online.room.arena = arena;
        sendOnlineAction('setting', { arena });
        if (!immediate) {
          audio.ui();
          setTimeout(() => {
            if (G.online && !G.online.active) openOnlineLobby();
          }, 0);
        }
      }
      return;
    }
    if (!immediate) {
      audio.ui();
      dom.arenaBtn.focus({ preventScroll: true });
    }
  }


  function playerCoin() {
    return G.coins.find((c) => c.id === G.playerId);
  }

  function activeDanger() {
    const p = playerCoin();
    if (!p || !p.alive) return false;
    return distanceToArenaOpenBoundary(p.x, p.y) < getArenaDangerBand();
  }

  function updatePowerUI() {
    const p = clamp(G.aim.power, 0, 1);
    dom.powerFill.style.width = `${(p * 100).toFixed(1)}%`;
    dom.powerValue.textContent = `${Math.round(p * 100)}%`;
    const active = G.active;
    const accent = active ? active.color : getPlayerDef().color;
    const aiming = G.phase === 'playerAim'
      || (G.phase === 'volleyAim' && active && !active.locked && G.volley && !G.volley.firing);
    const danger = aiming && G.aim.charging
      && (G.aim.power > 0.84 || willShotExit(G.active, G.aim.angle, G.aim.power));
    dom.turnDock.style.setProperty('--turn-accent', accent);
    dom.powerValue.style.color = accent;
    dom.powerFill.style.background = danger
      ? 'linear-gradient(90deg, #ffd166, #ff5f70)'
      : `linear-gradient(90deg, #47d8c4 0%, ${accent} 56%, ${shade(accent, -0.18)} 100%)`;
    dom.powerTrack.classList.toggle('danger', danger);
  }

  function updateSkillBadge() {
    if (!dom.skillBadge) return;
    const coin = playerCoin();
    const show = !!(coin && !G.resultOpen && G.phase !== 'menu'
      && G.phase !== 'over' && G.phase !== 'pending' && !G.playerOut);
    if (!show) {
      dom.skillBadge.hidden = true;
      if (dom.curveEnergy) dom.curveEnergy.hidden = true;
      dom.skillBadge.classList.remove('has-energy');
      return;
    }
    const def = coin.def;
    const isEcho = def.id === 'echo';
    const isCurve = def.id === 'curve';
    const isAnchor = def.id === 'anchor';
    dom.skillBadge.hidden = false;
    dom.skillBadge.style.setProperty('--skill-color', def.color);
    dom.skillBadge.style.setProperty('--skill-rgb', def.rgb);
    dom.skillBadgeIcon.textContent = def.glyph;
    dom.skillBadgeName.textContent = def.skill.name;
    dom.skillBadgeKicker.textContent = isEcho || isCurve || isAnchor ? '主动技能' : '本命技能';
    dom.skillBadgeKey.textContent = isCurve ? 'Q/E' : 'E';
    dom.skillBadge.classList.remove('is-ready', 'is-cooldown', 'is-active');
    dom.skillBadge.classList.toggle('has-energy', isCurve);
    if (dom.curveEnergy) dom.curveEnergy.hidden = !isCurve;
    if (isCurve) {
      const energy = clamp(Number(coin.energy) || 0, 0, CURVE_MAX_ENERGY);
      if (dom.curveEnergyFill) dom.curveEnergyFill.style.width = `${energy / CURVE_MAX_ENERGY * 100}%`;
      if (dom.curveEnergyValue) dom.curveEnergyValue.textContent = String(Math.round(energy));
      const sliding = coin.alive && Math.hypot(coin.vx, coin.vy) > 18;
      if (energy <= 0) {
        dom.skillBadgeHint.textContent = '能量耗尽 · 无法偏转';
        dom.skillBadge.classList.add('is-cooldown');
      } else if (sliding) {
        dom.skillBadgeHint.textContent = coin.curveActive ? '正在偏转 · 每秒消耗 5' : '滑行中 · Q 左偏 / E 右偏';
        dom.skillBadge.classList.add(coin.curveActive ? 'is-active' : 'is-ready');
      } else {
        dom.skillBadgeHint.textContent = '滑动时按住 Q / E 偏转';
        dom.skillBadge.classList.add('is-ready');
      }
      return;
    }
    if (isAnchor) {
      if (G.anchorBonus && G.anchorBonus.coinId === coin.id && G.anchorBonus.aiming) {
        dom.skillBadgeHint.textContent = '急停成功 · 二次瞄准';
        dom.skillBadge.classList.add('is-active');
      } else if (!coin.skillReady || coin.skillCooldown > 0) {
        dom.skillBadgeHint.textContent = coin.skillCooldown > 0
          ? `冷却 ${coin.skillCooldown} 回合`
          : '技能准备中';
        dom.skillBadge.classList.add('is-cooldown');
      } else if (G.phase === 'resolve' && Math.hypot(coin.vx, coin.vy) > 18) {
        dom.skillBadgeHint.textContent = '滑行中 · 按 E 急停';
        dom.skillBadge.classList.add('is-ready');
      } else {
        dom.skillBadgeHint.textContent = '滑行中按 E 急停并二次瞄准';
        dom.skillBadge.classList.add('is-ready');
      }
      return;
    }
    if (!isEcho) {
      dom.skillBadgeHint.textContent = def.skill.short;
      dom.skillBadgeKey.textContent = '被动';
      return;
    }
    if (!coin.skillReady || coin.skillCooldown > 0) {
      dom.skillBadgeHint.textContent = coin.skillCooldown > 0
        ? `冷却 ${coin.skillCooldown} 回合`
        : '折返下回合就绪';
      dom.skillBadge.classList.add('is-cooldown');
      return;
    }
    if (coin.marker) {
      if (echoEnemyWindow(coin)) {
        dom.skillBadgeHint.textContent = 'E 折返';
        dom.skillBadge.classList.add('is-active');
      } else if ((G.phase === 'playerAim' || G.phase === 'volleyAim') && G.active === coin) {
        dom.skillBadgeHint.textContent = '标记已留下 · 等敌人回合';
        dom.skillBadge.classList.add('is-active');
      } else {
        dom.skillBadgeHint.textContent = '等待敌人回合';
      }
      return;
    }
    if ((G.phase === 'playerAim' || G.phase === 'volleyAim') && G.active === coin) {
      if (G.phase === 'volleyAim' && coin.locked) {
        dom.skillBadgeHint.textContent = '本轮未留标';
        return;
      }
      if (canPlayerAim()) {
        dom.skillBadgeHint.textContent = 'E 留标';
        dom.skillBadge.classList.add('is-ready');
        return;
      }
    }
    dom.skillBadgeHint.textContent = '等待你的回合';
  }

  function updateCurveEnergyUI() {
    const coin = playerCoin();
    const isCurve = !!(coin && coin.def.id === 'curve');
    const show = isCurve
      && !G.playerOut
      && !G.resultOpen
      && G.phase !== 'menu'
      && G.phase !== 'over'
      && G.phase !== 'pending';
    if (dom.curveEnergy) dom.curveEnergy.hidden = !show;
    if (!dom.skillBadge) return;
    dom.skillBadge.classList.toggle('has-energy', show);
    if (!show) return;
    const energy = clamp(Number(coin.energy) || 0, 0, CURVE_MAX_ENERGY);
    if (dom.curveEnergyFill) dom.curveEnergyFill.style.width = `${energy / CURVE_MAX_ENERGY * 100}%`;
    if (dom.curveEnergyValue) dom.curveEnergyValue.textContent = String(Math.round(energy));
    const sliding = coin.alive && Math.hypot(coin.vx, coin.vy) > 18;
    if (energy <= 0) {
      dom.skillBadgeHint.textContent = '能量耗尽 · 无法偏转';
      dom.skillBadge.classList.remove('is-active', 'is-ready');
      dom.skillBadge.classList.add('is-cooldown');
    } else if (sliding) {
      dom.skillBadge.classList.remove('is-cooldown');
      dom.skillBadgeHint.textContent = coin.curveActive ? '正在偏转 · 每秒消耗 5' : '滑行中 · Q 左偏 / E 右偏';
      dom.skillBadge.classList.toggle('is-active', !!coin.curveActive);
      dom.skillBadge.classList.toggle('is-ready', !coin.curveActive);
    } else {
      dom.skillBadge.classList.remove('is-cooldown', 'is-active');
      dom.skillBadge.classList.add('is-ready');
      dom.skillBadgeHint.textContent = '滑动时按住 Q / E 偏转';
    }
  }

  function echoHintSuffix() {
    const coin = playerCoin();
    if (!coin || coin.def.id !== 'echo' || !coin.alive) return '';
    if (coin.skillCooldown > 0) {
      return `折返冷却 ${coin.skillCooldown} 回合`;
    }
    if (!coin.skillReady) return '折返下回合就绪';
    if (coin.marker) {
      if (echoEnemyWindow(coin)) return 'E 折返';
      if ((G.phase === 'playerAim' || G.phase === 'volleyAim') && G.active === coin) {
        return '标记已留下 · 等敌人回合';
      }
      return '';
    }
    if ((G.phase === 'playerAim' || G.phase === 'volleyAim') && G.active === coin) {
      return 'E 留标';
    }
    return '';
  }

  function updateHUD(force = false) {
    if (G.chase) {
      updateChaseHUD(force);
      return;
    }
    if (G.phase === 'menu') return;
    const active = G.active;
    const danger = activeDanger();
    const volleyAiming = G.phase === 'volleyAim' && active
      && active.id === G.playerId && !active.locked && G.volley && !G.volley.firing;
    const aimDanger = !!(active && active.id === G.playerId
      && (G.phase === 'playerAim' || volleyAiming)
      && G.aim.charging && willShotExit(active, G.aim.angle, G.aim.power));
    dom.turnDock.classList.toggle('ai-turn', G.phase === 'aiAim' || (!!active && active.id !== G.playerId && G.mode !== 'volley'));
    dom.turnDock.classList.toggle('is-spectator', G.playerOut);
    dom.turnDock.classList.toggle('is-danger', (danger || aimDanger) && (G.phase === 'playerAim' || G.phase === 'volleyAim' || G.phase === 'aiAim' || G.phase === 'resolve'));
    const turnTag = String(Math.max(1, G.turn)).padStart(2, '0');

    if (G.phase === 'intro') {
      dom.turnKicker.textContent = '准备中';
      dom.turnTitle.textContent = '硬币正在入场';
      dom.turnHint.textContent = `${G.matchSize} 枚硬币 · ${G.mode === 'volley' ? '齐射模式' : '轮流模式'}`;
      dom.powerLabel.textContent = '力度';
      G.aim.power = 0;
    } else if (G.phase === 'playerAim') {
      const online = !!(G.online && G.online.active);
      if (online && G.online.role === 'guest' && G.online.shotSent) {
        dom.turnKicker.textContent = `联机 · 第 ${turnTag} 回合 · 已发射`;
        dom.turnTitle.textContent = '等待房主同步';
        dom.turnHint.textContent = '你的角度与力度已提交 · 正在接收桌面状态';
        dom.powerLabel.textContent = '已锁定';
      } else {
        dom.turnKicker.textContent = online
          ? `联机 · 第 ${turnTag} 回合 · 你的回合`
          : `第 ${turnTag} 回合 · 你的回合`;
        dom.turnTitle.textContent = G.aim.charging ? '蓄力中 · 松开左键发射' : '瞄准，然后按住左键';
        dom.turnHint.textContent = aimDanger
          ? '危险：这个力度会让你滑出边界'
          : (danger
            ? '危险：你的硬币已接近边界，先拉开距离'
            : (G.aim.charging ? '方向可微调 · 力度决定滑行距离' : '鼠标指向决定方向 · 蓄力越久，发射越猛'));
        dom.powerLabel.textContent = '力度';
      }
    } else if (G.phase === 'onlineWait' && active) {
      dom.turnKicker.textContent = `联机 · 第 ${turnTag} 回合 · 等待对手`;
      const who = G.online && G.online.activeType === 'ai'
        ? (G.online.activeName || 'AI')
        : (G.online && G.online.activeName ? G.online.activeName : '对手');
      dom.turnTitle.textContent = `${who} 正在瞄准`;
      dom.turnHint.textContent = '联机对局 · 等待对手提交发射';
      dom.powerLabel.textContent = '对手';
    } else if (G.phase === 'volleyAim') {
      const volley = G.volley || { locked: 0, alive: 1, playerLocked: false, firing: false };
      const locked = volley.locked || 0;
      const total = volley.alive || 1;
      const localCoin = G.coins.find((coin) => coin.id === (G.online ? G.online.localCoin : G.playerId));
      const localSkipped = !!(localCoin && localCoin.volleySkipped);
      dom.turnKicker.textContent = G.playerOut ? '齐射 · 观战' : '齐射 · 同时发射';
      if (volley.firing) {
        dom.turnTitle.textContent = '齐射！';
        dom.turnHint.textContent = `${locked} / ${total} 已锁定 · 准备发射`;
      } else if (G.playerOut) {
        dom.turnTitle.textContent = '等待 AI 锁定';
        dom.turnHint.textContent = `${locked} / ${total} 已锁定 · 全部锁定后同时发射`;
      } else if (localSkipped) {
        dom.turnTitle.textContent = '锁定超时 · 本轮跳过';
        dom.turnHint.textContent = `${locked} / ${total} 已处理 · 等待其他硬币锁定`;
      } else if (volley.playerLocked) {
        dom.turnTitle.textContent = '已锁定 · 等待其他硬币';
        dom.turnHint.textContent = `${locked} / ${total} 已锁定 · 全部锁定后同时发射`;
      } else {
        dom.turnTitle.textContent = G.aim.charging ? '蓄力中 · 松开左键锁定' : '瞄准，然后锁定齐射';
        dom.turnHint.textContent = `${locked} / ${total} 已锁定 · 松开左键后不可更改`;
      }
      dom.powerLabel.textContent = G.playerOut ? '齐射' : '你的力度';
    } else if (G.phase === 'aiAim' && active) {
      dom.turnKicker.textContent = G.playerOut ? '观战模式 · AI 行动' : `第 ${turnTag} 回合 · 对手行动`;
      const plan = G.ai.plan;
      const actor = G.online && G.online.activeType === 'ai'
        ? (G.online.activeName || active.name)
        : active.name;
      dom.turnTitle.textContent = plan ? `${actor} 正在蓄力` : `${actor} 正在观察桌面`;
      dom.turnHint.textContent = G.playerOut
        ? '你已出局 · 观看 AI 对决直到冠军诞生'
        : (plan && plan.target && plan.target.id === G.playerId
          ? '它瞄准的是你 · 注意自己的边界位置'
          : '轨迹已暴露 · 观察它准备撞向谁');
      dom.powerLabel.textContent = G.playerOut ? 'AI 力度' : '对手力度';
    } else if (G.phase === 'resolve') {
      const online = !!(G.online && G.online.active);
      dom.turnKicker.textContent = online
        ? '联机 · 双方同步'
        : (G.mode === 'volley'
          ? (G.playerOut ? '齐射 · 观战结算' : '齐射 · 全体滑行')
          : (G.playerOut ? '观战模式 · 回合结算' : '硬币滑行中'));
      dom.turnTitle.textContent = G.playerOut ? '硬币已经出界' : '等待桌面静止';
      dom.turnHint.textContent = online
        ? '桌面状态由房主同步 · 动量与碰撞正在计算'
        : (G.mode === 'volley'
          ? '所有硬币同时滑行 · 动量会彼此叠加'
          : (G.playerOut
            ? '你已出局 · 镜头会自动跟随当前行动的硬币'
            : '动量传递、反弹与出界正在实时计算'));
      dom.powerLabel.textContent = G.mode === 'volley' ? '齐射' : (G.playerOut ? 'AI 力度' : '力度');
    } else if (G.phase === 'pending') {
      const online = !!(G.online && G.online.active);
      dom.turnKicker.textContent = online
        ? '联机 · 结算中'
        : (G.playerOut ? '观战模式 · 结算中' : '边界之外');
      dom.turnTitle.textContent = G.pending && G.pending.result === 'win'
        ? '你是最后一枚硬币'
        : (G.playerOut ? '冠军即将诞生' : '一枚硬币正在坠落');
      dom.turnHint.textContent = online
        ? '正在同步最终结果'
        : (G.playerOut
          ? '你已出局 · 正在结算最后的 AI 对决'
          : '出局判定 · 对局即将结算');
      dom.powerLabel.textContent = G.playerOut ? 'AI 力度' : '力度';
    } else if (G.phase === 'over') {
      dom.turnKicker.textContent = '对局结束';
      dom.turnTitle.textContent = G.pending && G.pending.result === 'defeat' ? '你的硬币已经出界' : '桌面已经清空';
      dom.turnHint.textContent = G.online && G.online.active
        ? '查看结算数据 · 返回主菜单离开房间'
        : '按 R 重开 · 查看结算数据';
    }

    const alive = G.coins.filter((c) => c.alive).length;
    const volleyPrefix = G.mode === 'volley' && !G.playerOut ? '齐射 · ' : '';
    const onlinePrefix = G.online && G.online.active ? '联机 · ' : '';
    dom.liveLabel.textContent = G.playerOut
      ? `${onlinePrefix}观战 · 第 ${String(Math.max(1, G.turn)).padStart(2, '0')} 回合`
      : `${onlinePrefix}${volleyPrefix}第 ${String(Math.max(1, G.turn)).padStart(2, '0')} 回合`;
    updateArenaHudLabel();
    if (dom.arenaLabel) {
      dom.arenaLabel.textContent = arenaHudLabelText();
    }
    dom.aliveLabel.textContent = `${alive} 枚在场`;
    dom.hitCounter.textContent = String(G.stats.hits).padStart(2, '0');
    dom.speedCounter.textContent = `${Math.round(G.stats.topSpeed * 0.1)} km/h`;
    dom.timeCounter.textContent = formatTime(G.stats.elapsed);
    if (dom.difficultyCounter) dom.difficultyCounter.textContent = getAIDifficulty().label;
    if (dom.difficultyLabel) {
      dom.difficultyLabel.textContent = G.online && G.online.active ? '对局模式' : 'AI 难度';
    }
    if (dom.difficultyCounter && G.online && G.online.active) {
      dom.difficultyCounter.textContent = `联机 ${G.participants.length} 人`;
    }
    const echoSuffix = echoHintSuffix();
    if (echoSuffix) dom.turnHint.textContent = `${dom.turnHint.textContent} · ${echoSuffix}`;
    updateSkillBadge();
    updateRoster();
    updatePowerUI();
    updateShotClockUI();
  }

  function updateDynamicHUD() {
    if (G.chase) {
      updateChaseHUD(false);
      return;
    }
    updatePowerUI();
    updateCurveEnergyUI();
    dom.timeCounter.textContent = formatTime(G.stats.elapsed);
    const aimingPhase = G.phase === 'playerAim'
      || (G.phase === 'volleyAim' && canPlayerAim());
    if (aimingPhase) {
      const danger = activeDanger();
      const aimDanger = G.aim.charging && willShotExit(G.active, G.aim.angle, G.aim.power);
      dom.turnDock.classList.toggle('is-danger', danger || aimDanger);
      if (G.aim.charging) {
        const volley = G.phase === 'volleyAim';
        dom.turnTitle.textContent = G.aim.power >= 0.995
          ? (volley ? '最大力度 · 松开锁定' : '最大力度 · 松开左键发射')
          : (volley ? '蓄力中 · 松开左键锁定' : '蓄力中 · 松开左键发射');
        dom.turnHint.textContent = aimDanger
          ? '危险：这个力度会让你滑出边界'
          : (danger ? '危险：硬币已接近边界' : (volley ? '方向可微调 · 松开后等待齐射' : '方向可微调 · 力度决定滑行距离'));
      }
    }
    const active = G.active;
    if (G.phase === 'aiAim' && active) {
      dom.powerValue.textContent = `${Math.round(G.aim.power * 100)}%`;
    }
  }

  /* =========================================================
     Help / modals
     ========================================================= */
  function syncAIPersonaButton() {
    if (!dom.aiPersonaBtn) return;
    const hasAI = G.coins.some((coin) => isAIControlledCoin(coin) && coin.personality);
    const show = !G.chase
      && !G.resultOpen
      && !G.quitOpen
      && !G.aiPersonaOpen
      && G.phase !== 'menu'
      && G.phase !== 'over'
      && hasAI;
    dom.aiPersonaBtn.hidden = !show;
  }

  function renderAIPersonaList() {
    if (!dom.aiPersonaList) return;
    const aiCoins = G.coins.filter((coin) => isAIControlledCoin(coin));
    if (!aiCoins.length) {
      dom.aiPersonaList.innerHTML = '<p class="persona-empty">本局没有 AI 追兵。</p>';
      return;
    }
    dom.aiPersonaList.innerHTML = aiCoins.map((coin) => {
      const personality = coin.personality || AI_PERSONALITIES[0];
      return `
        <article class="persona-item" role="listitem" style="--coin-color:${coin.def.color};--coin-rgb:${coin.def.rgb};--persona-color:${personality.color}">
          <span class="persona-orb" aria-hidden="true">${coin.def.glyph}</span>
          <span class="persona-name"><strong>${coin.def.name}</strong><small>${coin.def.role}${coin.alive ? '' : ' · 已出局'}</small></span>
          <span class="persona-style"><b>${personality.name}</b><span>${personality.desc}</span></span>
        </article>
      `;
    }).join('');
  }

  function openAIPersona() {
    if (G.chase || G.phase === 'menu' || G.phase === 'over' || G.resultOpen || G.aiPersonaOpen) return;
    if (G.helpOpen || G.inspectOpen || G.codexOpen || G.arenaOpen || G.quitOpen) return;
    cancelCharge();
    G.aiPersonaOpen = true;
    if (!(G.online && G.online.active)) G.paused = true;
    G.pointer.down = false;
    renderAIPersonaList();
    dom.hud.inert = true;
    dom.aiPersona.classList.add('is-open');
    dom.aiPersona.setAttribute('aria-hidden', 'false');
    syncGameExitButtons();
    audio.init();
    audio.ui();
    setTimeout(() => {
      if (G.aiPersonaOpen) dom.aiPersonaClose.focus({ preventScroll: true });
    }, 120);
  }

  function closeAIPersona(immediate = false) {
    if (!G.aiPersonaOpen && !immediate) return;
    G.aiPersonaOpen = false;
    dom.aiPersona.classList.remove('is-open');
    dom.aiPersona.setAttribute('aria-hidden', 'true');
    if (G.phase !== 'menu') {
      G.paused = false;
      dom.hud.inert = false;
    }
    syncGameExitButtons();
    if (!immediate && G.phase !== 'menu') {
      dom.aiPersonaBtn.focus({ preventScroll: true });
      audio.ui();
    }
  }

  function syncGameExitButtons() {
    if (!dom.quitGameBtn) return;
    const online = !!(G.online && G.online.active);
    const show = !online
      && !G.quitOpen
      && !G.resultOpen
      && G.phase !== 'menu'
      && G.phase !== 'over';
    dom.quitGameBtn.hidden = !show;
    syncAIPersonaButton();
  }

  function openQuitConfirm() {
    if (G.online && G.online.active) return;
    if (G.phase === 'menu' || G.phase === 'over' || G.resultOpen || G.quitOpen) return;
    if (G.helpOpen || G.inspectOpen || G.codexOpen || G.arenaOpen || G.aiPersonaOpen) return;
    cancelCharge();
    if (G.chase) cancelChaseCharge();
    G.quitOpen = true;
    G.paused = true;
    clearPanKeys();
    G.pointer.down = false;
    if (dom.quitDesc) {
      dom.quitDesc.textContent = G.chase
        ? '当前追击进度不会保存，确认后会回到主菜单。'
        : '当前对局进度不会保存，确认后会回到主菜单。';
    }
    dom.hud.inert = true;
    dom.quit.classList.add('is-open');
    dom.quit.setAttribute('aria-hidden', 'false');
    syncGameExitButtons();
    audio.init();
    audio.ui();
    setTimeout(() => {
      if (G.quitOpen) dom.quitCancel.focus({ preventScroll: true });
    }, 120);
  }

  function closeQuitConfirm(immediate = false) {
    if (!G.quitOpen && !immediate) return;
    G.quitOpen = false;
    dom.quit.classList.remove('is-open');
    dom.quit.setAttribute('aria-hidden', 'true');
    if (G.phase !== 'menu') {
      G.paused = false;
      dom.hud.inert = false;
    }
    syncGameExitButtons();
    if (!immediate && G.phase !== 'menu') {
      dom.quitGameBtn.focus({ preventScroll: true });
      audio.ui();
    }
  }

  function confirmQuitGame() {
    if (!G.quitOpen) return;
    closeQuitConfirm(true);
    closeAIPersona(true);
    returnToMenu();
  }

  function openHelp() {
    if (G.online && G.online.active) {
      addToast('联机对局中不能暂停查看玩法', 'info', 1800);
      return;
    }
    if (G.helpOpen) return;
    clearPanKeys();
    if (G.chase) G.chase.keys = { up: false, down: false, left: false, right: false };
    if (G.arenaOpen) closeArena(true);
    if (G.codexOpen) closeCodex(true);
    if (G.inspectOpen) closeInspect(true);
    audio.init();
    audio.ui();
    G.helpOpen = true;
    if (G.phase !== 'menu' && G.phase !== 'over') {
      G.paused = true;
      dom.hud.inert = true;
    }
    dom.menu.inert = true;
    cancelCharge();
    dom.help.classList.add('is-open');
    dom.help.setAttribute('aria-hidden', 'false');
  }

  function closeHelp(immediate = false) {
    if (!G.helpOpen && !immediate) return;
    G.helpOpen = false;
    dom.help.classList.remove('is-open');
    dom.help.setAttribute('aria-hidden', 'true');
    if (G.phase !== 'menu' && G.phase !== 'over') {
      G.paused = false;
      if (!G.resultOpen) dom.hud.inert = false;
    }
    if (G.phase === 'menu') dom.menu.inert = false;
  }

  function toggleSound() {
    audio.init();
    const muted = audio.toggleMuted();
    dom.soundToggle.classList.toggle('sound-muted', muted);
    dom.soundToggle.setAttribute('aria-label', muted ? '开启声音' : '关闭声音');
    if (!muted) audio.ui();
    addToast(muted ? '声音已关闭' : '声音已开启', 'info', 1500);
  }

  async function toggleFullscreen() {
    audio.ui();
    try {
      if (!document.fullscreenElement) {
        await dom.stage.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (e) {
      addToast('当前环境不支持全屏', 'info', 1800);
    }
  }

  /* =========================================================
     Aim / charging
     ========================================================= */
  function updateAimFromPointer() {
    const active = G.active;
    if (!active || !active.alive) return;
    const dx = G.pointer.worldX - active.x;
    const dy = G.pointer.worldY - active.y;
    const d = Math.hypot(dx, dy);
    if (d > active.radius * 0.55) {
      G.aim.angle = Math.atan2(dy, dx);
    }
  }

  function canPlayerAim() {
    if (G.online && G.online.active) {
      if (G.online.timer && G.online.timer.remaining <= 0) return false;
      if (G.phase === 'playerAim') return !G.online.shotSent;
      if (G.phase === 'volleyAim' && G.volley && !G.volley.firing) {
        const local = G.coins.find((coin) => coin.id === G.online.localCoin);
        return !!(local && local.alive && !local.locked);
      }
      return false;
    }
    if (G.phase === 'playerAim') return true;
    if (G.phase !== 'volleyAim' || !G.volley || G.volley.firing) return false;
    const player = playerCoin();
    return !!(player && player.alive && !player.locked);
  }

  function startCharge() {
    if (!canPlayerAim() || G.paused || G.helpOpen || G.resultOpen) return;
    const active = G.active;
    if (!active || !active.alive) return;
    if (G.aim.charging) return;
    audio.init();
    updateAimFromPointer();
    G.aim.charging = true;
    G.aim.chargeT = 0;
    G.aim.power = 0;
    G.pointer.down = true;
    audio.startCharge();
    updateHUD(true);
  }

  function cancelCharge() {
    if (!G.aim.charging) return;
    G.aim.charging = false;
    G.aim.chargeT = 0;
    G.aim.power = 0;
    G.pointer.down = false;
    audio.stopCharge();
    updateHUD(true);
  }

  function releaseCharge() {
    if (!G.aim.charging || !canPlayerAim()) {
      G.aim.charging = false;
      G.pointer.down = false;
      return;
    }
    const active = G.active;
    if (!active || !active.alive) {
      cancelCharge();
      return;
    }
    const power = clamp(G.aim.power, 0, 1);
    G.aim.charging = false;
    G.pointer.down = false;
    if (G.online && G.online.active && G.online.role === 'guest') {
      const local = G.coins.find((coin) => coin.id === G.online.localCoin);
      if (G.phase === 'volleyAim' && G.volley && local && local.alive && !local.locked) {
        local.locked = true;
        local.volleySkipped = false;
        G.online.lockSentRound = G.volley.round;
        G.volley.playerLocked = true;
        G.volley.locked = Math.min(G.volley.alive, G.volley.locked + 1);
        G.aim.charging = false;
        G.pointer.down = false;
        audio.stopCharge();
        audio.ping(760, 0.08, 0.02, 'triangle', 0, 0.9);
        sendOnlineAction('lock', {
          coin: local.id,
          angle: G.aim.angle,
          power: Math.max(0.04, power),
        });
        updateHUD(true);
        return;
      }
      G.online.shotSent = true;
      audio.stopCharge();
      audio.launch(Math.max(0.04, power));
      sendOnlineAction('shot', {
        coin: active.id,
        angle: G.aim.angle,
        power: Math.max(0.04, power),
      });
      updateHUD(true);
      return;
    }
    if (G.mode === 'volley' && G.phase === 'volleyAim') {
      lockPlayerVolley();
    } else {
      fireCoin(active, G.aim.angle, Math.max(0.04, power));
    }
  }

  /* =========================================================
     Physics
     ========================================================= */
  function launchSpeedForPower(coin, power) {
    const p = clamp(power, 0, 1);
    let speed = lerp(coin.def.launchMin, coin.def.launchMax, p);
    if (coin.def.id === 'gold' && p >= 0.75) speed *= 1.08;
    if (coin.def.id === 'azure' && p >= 0.5 && p <= 0.78) speed *= 1.1;
    if (coin.def.id === 'amber' && p >= 0.9) speed *= 1.16;
    return speed;
  }

  function shotFrictionScale(coin, power) {
    let scale = coin.def.frictionScale || 1;
    if (coin.def.id === 'amber' && power >= 0.9) scale = 1.14;
    return scale;
  }

  function travelDistance(v, frictionScale = 1) {
    if (v <= 0) return 0;
    const k = PHYS.drag * frictionScale;
    const a = PHYS.rolling * frictionScale;
    return v / k - (a / (k * k)) * Math.log(1 + (k * v) / a);
  }

  function getAimRimHit(coin, angle) {
    return rayArenaIntersection(
      coin.x,
      coin.y,
      Math.cos(angle),
      Math.sin(angle),
      R + coin.radius * 0.18,
    );
  }

  function distanceToRim(coin, angle) {
    const hit = getAimRimHit(coin, angle);
    return hit ? hit.t : Infinity;
  }

  function willShotExit(coin, angle, power) {
    if (!coin) return false;
    const hit = getAimRimHit(coin, angle);
    if (!hit || hit.isWall) return false;
    const speed = launchSpeedForPower(coin, power);
    return travelDistance(speed, shotFrictionScale(coin, power)) > hit.t;
  }

  function speedForDistance(d) {
    let lo = 20;
    let hi = 1700;
    for (let i = 0; i < 28; i += 1) {
      const mid = (lo + hi) / 2;
      if (travelDistance(mid) < d) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function sendCurveInput() {
    if (!(G.online && G.online.active && G.online.role === 'guest')) return;
    sendOnlineAction('curve', {
      right: !!G.curveInput.right,
      left: !!G.curveInput.left,
    });
  }

  function setCurveInput(side, down) {
    if (side === 'right') G.curveInput.right = !!down;
    if (side === 'left') G.curveInput.left = !!down;
    sendCurveInput();
  }

  function clearCurveInput() {
    if (!G.curveInput.left && !G.curveInput.right) return;
    G.curveInput.left = false;
    G.curveInput.right = false;
    sendCurveInput();
  }

  function blackDogCurveInput(coin) {
    if (!coin || coin.energy <= 0) return null;
    const boundaryDistance = distanceToArenaOpenBoundary(coin.x, coin.y);
    let desired = null;
    if (boundaryDistance < R * 0.2) {
      desired = Math.atan2(-coin.y, -coin.x);
    } else {
      const target = chooseAITarget(coin);
      if (target) desired = Math.atan2(target.y - coin.y, target.x - coin.x);
    }
    if (desired === null) return null;
    const velocityAngle = Math.atan2(coin.vy, coin.vx);
    const diff = Math.atan2(Math.sin(desired - velocityAngle), Math.cos(desired - velocityAngle));
    if (Math.abs(diff) < 0.045) return null;
    return { left: diff < 0, right: diff > 0 };
  }

  function curveInputForCoin(coin) {
    if (!coin || coin.def.id !== 'curve') return null;
    if (isAIControlledCoin(coin) && coin.personality && coin.personality.id === 'blackdog') {
      return blackDogCurveInput(coin);
    }
    if (G.online && G.online.active) {
      if (coin.id === G.online.localCoin) return G.curveInput;
      if (G.online.role === 'host') {
        return { left: !!coin.remoteCurveLeft, right: !!coin.remoteCurveRight };
      }
      return null;
    }
    if (coin.id === G.playerId) return G.curveInput;
    return null;
  }

  function applyCurveSteering(coin, dt) {
    if (!coin || !coin.alive || coin.def.id !== 'curve') return;
    const input = curveInputForCoin(coin);
    const speed = Math.hypot(coin.vx, coin.vy);
    const direction = input
      ? (input.right ? 1 : 0) - (input.left ? 1 : 0)
      : 0;
    if (!direction || speed < 20 || coin.energy <= 0) {
      coin.curveHold = Math.max(0, coin.curveHold - dt * 2.6);
      coin.curveActive = false;
      return;
    }
    coin.curveHold = Math.min(3.5, coin.curveHold + dt);
    const ramp = clamp(coin.curveHold / CURVE_HOLD_RAMP, 0, 1);
    const rate = lerp(CURVE_TURN_MIN, CURVE_TURN_MAX, ramp);
    const angle = rate * direction * dt;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const vx = coin.vx * cos - coin.vy * sin;
    const vy = coin.vx * sin + coin.vy * cos;
    coin.vx = vx;
    coin.vy = vy;
    coin.energy = Math.max(0, coin.energy - CURVE_ENERGY_DRAIN * dt);
    coin.curveActive = true;
    if (coin.energy <= 0) {
      coin.curveHold = 0;
      coin.curveActive = false;
    }
  }

  function updatePhysics(dt) {
    if (dt <= 0) return;
    const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dt / (1 / 120))));
    const h = dt / steps;
    for (let step = 0; step < steps; step += 1) {
      updateObstacles(h);
      for (const coin of G.coins) {
        if (!coin.alive) continue;
        if (coin.anchorHeld) {
          coin.x = coin.anchorX;
          coin.y = coin.anchorY;
          coin.vx = 0;
          coin.vy = 0;
          coin.speed = 0;
          coin.spin = 0;
          continue;
        }
        applyCurveSteering(coin, h);
        const speed = Math.hypot(coin.vx, coin.vy);
        if (speed <= 0) {
          coin.speed = 0;
          continue;
        }
        const frictionScale = coin.frictionScale || 1;
        const drag = PHYS.drag * frictionScale;
        const rolling = PHYS.rolling * frictionScale;
        const nextSpeed = Math.max(0, speed * Math.exp(-drag * h) - rolling * h);
        if (nextSpeed < PHYS.stop) {
          coin.vx = 0;
          coin.vy = 0;
          coin.speed = 0;
          continue;
        }
        const scale = nextSpeed / speed;
        coin.vx *= scale;
        coin.vy *= scale;
        coin.x += coin.vx * h;
        coin.y += coin.vy * h;
        coin.rot += coin.spin * h;
        coin.spin *= Math.exp(-1.3 * h);
        coin.speed = nextSpeed;
        G.stats.topSpeed = Math.max(G.stats.topSpeed, nextSpeed);
      }

      resolveCoinCollisions();
      resolveObstacleCoinCollisions();
      resolveObstacleObstacleCollisions();
      resolveWallCollisions();
      resolveObstacleBoundaryCollisions();
    }
    checkBoundaries();
  }

  function obstacleWorldPoints(obstacle) {
    const points = obstaclePoints(obstacle);
    const cos = Math.cos(obstacle.rot);
    const sin = Math.sin(obstacle.rot);
    return points.map((point) => ({
      x: obstacle.x + point.x * cos - point.y * sin,
      y: obstacle.y + point.x * sin + point.y * cos,
    }));
  }

  function pointInConvexPolygon(points, x, y) {
    let sign = 0;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
      if (Math.abs(cross) < 0.0001) continue;
      if (sign === 0) sign = Math.sign(cross);
      else if (Math.sign(cross) !== sign) return false;
    }
    return true;
  }

  function closestPointOnSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1) : 0;
    return { x: ax + dx * t, y: ay + dy * t };
  }

  function obstacleCoinHit(coin, obstacle) {
    if (obstacle.shape === 'circle') {
      const dx = coin.x - obstacle.x;
      const dy = coin.y - obstacle.y;
      const dist = Math.hypot(dx, dy);
      const minDist = coin.radius + obstacle.radius;
      if (dist >= minDist) return null;
      const nx = dist > 0.001 ? dx / dist : 1;
      const ny = dist > 0.001 ? dy / dist : 0;
      return {
        nx,
        ny,
        penetration: minDist - dist,
        contactX: obstacle.x + nx * obstacle.radius,
        contactY: obstacle.y + ny * obstacle.radius,
      };
    }
    const points = obstacleWorldPoints(obstacle);
    if (!points.length) return null;
    const inside = pointInConvexPolygon(points, coin.x, coin.y);
    let best = null;
    let bestDist = Infinity;
    let bestEdge = null;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const point = closestPointOnSegment(coin.x, coin.y, a.x, a.y, b.x, b.y);
      const d = Math.hypot(coin.x - point.x, coin.y - point.y);
      if (d < bestDist) {
        bestDist = d;
        best = point;
        bestEdge = { a, b };
      }
    }
    if (inside) {
      const a = bestEdge.a;
      const b = bestEdge.b;
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const len = Math.hypot(ex, ey) || 1;
      let nx = ey / len;
      let ny = -ex / len;
      if (nx * (coin.x - obstacle.x) + ny * (coin.y - obstacle.y) < 0) {
        nx = -nx;
        ny = -ny;
      }
      const signed = (coin.x - best.x) * nx + (coin.y - best.y) * ny;
      return {
        nx,
        ny,
        penetration: coin.radius - signed,
        contactX: best.x,
        contactY: best.y,
      };
    }
    if (bestDist >= coin.radius) return null;
    const nx = bestDist > 0.001 ? (coin.x - best.x) / bestDist : 1;
    const ny = bestDist > 0.001 ? (coin.y - best.y) / bestDist : 0;
    return {
      nx,
      ny,
      penetration: coin.radius - bestDist,
      contactX: best.x,
      contactY: best.y,
    };
  }

  function updateObstacles(dt) {
    for (const obstacle of G.obstacles) {
      obstacle.flash = Math.max(0, obstacle.flash - dt * 3.4);
      if (!obstacle.movable) continue;
      const speed = Math.hypot(obstacle.vx, obstacle.vy);
      if (speed <= 0) continue;
      const drag = Math.exp(-1.9 * dt);
      obstacle.vx *= drag;
      obstacle.vy *= drag;
      if (Math.hypot(obstacle.vx, obstacle.vy) < 5) {
        obstacle.vx = 0;
        obstacle.vy = 0;
      }
      obstacle.x += obstacle.vx * dt;
      obstacle.y += obstacle.vy * dt;
      obstacle.rot += obstacle.spin * dt;
      obstacle.spin *= Math.exp(-2 * dt);
    }
  }

  function resolveObstacleCoinCollisions() {
    if (!G.obstacles.length) return;
    for (const coin of G.coins) {
      if (!coin.alive) continue;
      for (const obstacle of G.obstacles) {
        const hit = obstacleCoinHit(coin, obstacle);
        if (!hit) continue;
        const invCoin = 1 / Math.max(0.2, coin.mass);
        const invObstacle = obstacle.movable ? 1 / Math.max(0.5, obstacle.mass) : 0;
        const invSum = invCoin + invObstacle || invCoin;
        const correction = Math.max(0, hit.penetration) * 0.92;
        coin.x += hit.nx * correction * (invCoin / invSum);
        coin.y += hit.ny * correction * (invCoin / invSum);
        if (obstacle.movable) {
          obstacle.x -= hit.nx * correction * (invObstacle / invSum);
          obstacle.y -= hit.ny * correction * (invObstacle / invSum);
        }
        const rvx = coin.vx - obstacle.vx;
        const rvy = coin.vy - obstacle.vy;
        const along = rvx * hit.nx + rvy * hit.ny;
        if (along < 0) {
          const restitution = obstacle.movable ? 0.76 : (coin.def.wallRestitution || 0.58);
          const impulse = -(1 + restitution) * along / invSum;
          coin.vx += impulse * invCoin * hit.nx;
          coin.vy += impulse * invCoin * hit.ny;
          if (obstacle.movable) {
            obstacle.vx -= impulse * invObstacle * hit.nx;
            obstacle.vy -= impulse * invObstacle * hit.ny;
            obstacle.spin += clamp(impulse * invObstacle * 0.003, -2.5, 2.5);
          }
          const tangentX = -hit.ny;
          const tangentY = hit.nx;
          const tangentSpeed = rvx * tangentX + rvy * tangentY;
          const tangentImpulse = clamp(-tangentSpeed * 0.04, -impulse * 0.2, impulse * 0.2);
          coin.vx -= tangentImpulse * invCoin * tangentX;
          coin.vy -= tangentImpulse * invCoin * tangentY;
          if (obstacle.movable) {
            obstacle.vx += tangentImpulse * invObstacle * tangentX;
            obstacle.vy += tangentImpulse * invObstacle * tangentY;
          }
          coin.flash = Math.max(coin.flash, clamp(Math.abs(along) / 900, 0.15, 0.75));
          obstacle.flash = Math.max(obstacle.flash, 1);
          coin.speed = Math.hypot(coin.vx, coin.vy);
          const power = clamp(Math.abs(along) / 950, 0.1, 1);
          if (Math.abs(along) > 60) {
            const colors = obstacle.movable
              ? [coin.color, '#ffd166', '#ffcf82']
              : [coin.color, '#8ff3e2', '#e7fff9'];
            addSparks(hit.contactX, hit.contactY, 6 + Math.round(power * 12), colors, 160 + power * 360, Math.PI * 0.8, Math.atan2(-hit.ny, -hit.nx));
            addWave(
              hit.contactX,
              hit.contactY,
              20 + power * 34,
              obstacle.movable ? 'rgba(255,190,100,0.5)' : 'rgba(90,231,212,0.45)',
              0.24 + power * 0.2,
              1.2 + power,
              false,
            );
            addShake(0.8 + power * 3);
            audio.wallBounce(power);
          }
        }
      }
    }
  }

  function resolveObstacleObstacleCollisions() {
    for (let i = 0; i < G.obstacles.length; i += 1) {
      const a = G.obstacles[i];
      for (let j = i + 1; j < G.obstacles.length; j += 1) {
        const b = G.obstacles[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minDist = a.radius + b.radius;
        const d = Math.hypot(dx, dy);
        if (d >= minDist || d <= 0.001) continue;
        const nx = dx / d;
        const ny = dy / d;
        const invA = a.movable ? 1 / Math.max(0.5, a.mass) : 0;
        const invB = b.movable ? 1 / Math.max(0.5, b.mass) : 0;
        const invSum = invA + invB;
        if (!invSum) continue;
        const overlap = minDist - d;
        a.x -= nx * overlap * (invA / invSum) * 0.9;
        a.y -= ny * overlap * (invA / invSum) * 0.9;
        b.x += nx * overlap * (invB / invSum) * 0.9;
        b.y += ny * overlap * (invB / invSum) * 0.9;
        const along = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (along < 0) {
          const impulse = -(1 + 0.55) * along / invSum;
          a.vx -= impulse * invA * nx;
          a.vy -= impulse * invA * ny;
          b.vx += impulse * invB * nx;
          b.vy += impulse * invB * ny;
        }
      }
    }
  }

  function resolveObstacleBoundaryCollisions() {
    for (const obstacle of G.obstacles) {
      if (!obstacle.movable) continue;
      const dist = Math.hypot(obstacle.x, obstacle.y);
      if (dist <= 0.001) continue;
      const angle = Math.atan2(obstacle.y, obstacle.x);
      const boundary = getArenaBoundaryAtAngle(angle);
      const boundaryDist = boundary ? Math.hypot(boundary.x, boundary.y) : R;
      const limit = boundaryDist - obstacle.radius - 1;
      if (dist <= limit) continue;
      const nx = obstacle.x / dist;
      const ny = obstacle.y / dist;
      obstacle.x = nx * Math.max(obstacle.radius, limit);
      obstacle.y = ny * Math.max(obstacle.radius, limit);
      const outward = obstacle.vx * nx + obstacle.vy * ny;
      if (outward > 0) {
        const tx = -ny;
        const ty = nx;
        const tangent = obstacle.vx * tx + obstacle.vy * ty;
        obstacle.vx = -outward * 0.55 * nx + tangent * 0.9 * tx;
        obstacle.vy = -outward * 0.55 * ny + tangent * 0.9 * ty;
      }
    }
  }

  function resolveWallCollisions() {
    const shape = getArenaShape();
    if (!shape.points) return;
    const walls = getArenaEdges().filter((edge) => edge.isWall);
    if (!walls.length) return;
    for (const coin of G.coins) {
      if (!coin.alive) continue;
      for (const edge of walls) {
        const t = ((coin.x - edge.a.x) * edge.ex + (coin.y - edge.a.y) * edge.ey) / (edge.len * edge.len);
        if (t < -0.015 || t > 1.015) continue;
        const signed = (coin.x - edge.a.x) * edge.nx + (coin.y - edge.a.y) * edge.ny;
        if (signed > coin.radius + 2 || signed < -coin.radius - 1) continue;
        const penetration = coin.radius - signed;
        if (penetration <= 0) continue;
        const outwardSpeed = coin.vx * edge.nx + coin.vy * edge.ny;
        if (outwardSpeed < -25 && penetration < coin.radius * 0.55) continue;

        const tangentSpeed = coin.vx * edge.tx + coin.vy * edge.ty;
        coin.x -= edge.nx * (penetration + 0.2);
        coin.y -= edge.ny * (penetration + 0.2);
        const restitution = coin.def.wallRestitution || 0.56;
        const tangentKeep = coin.def.wallTangent || 0.92;
        if (outwardSpeed > 0) {
          coin.vx = -outwardSpeed * restitution * edge.nx + tangentSpeed * tangentKeep * edge.tx;
          coin.vy = -outwardSpeed * restitution * edge.ny + tangentSpeed * tangentKeep * edge.ty;
        } else {
          coin.vx = tangentSpeed * 0.98 * edge.tx + outwardSpeed * 0.98 * edge.nx;
          coin.vy = tangentSpeed * 0.98 * edge.ty + outwardSpeed * 0.98 * edge.ny;
        }
        coin.speed = Math.hypot(coin.vx, coin.vy);
        coin.flash = Math.max(coin.flash, clamp(Math.abs(outwardSpeed) / 1000, 0.15, 0.75));

        if (outwardSpeed > 35) {
          const contactX = edge.a.x + edge.ex * clamp(t, 0, 1);
          const contactY = edge.a.y + edge.ey * clamp(t, 0, 1);
          const power = clamp(outwardSpeed / 1050, 0.12, 1);
          addSparks(
            contactX,
            contactY,
            8 + Math.round(power * 18),
            [coin.color, '#ffd166', '#fff3cf'],
            180 + power * 420,
            Math.PI * 0.8,
            Math.atan2(-edge.ny, -edge.nx),
          );
          addWave(contactX, contactY, 26 + power * 54, 'rgba(255,209,102,0.6)', 0.3 + power * 0.22, 1.4 + power * 1.6, false);
          addPuff(contactX, contactY, 3 + Math.round(power * 7), 'rgba(255,220,160,0.10)', 40 + power * 80);
          addShake(1 + power * 5);
          if (coin.def.id === 'rose') {
            addFloatingText(contactX, contactY - 24, '镜壁', '#ffe2ec', 10, 0.8);
            addWave(contactX, contactY, 22 + power * 28, 'rgba(255,134,173,0.5)', 0.3, 1.1, false);
          }
          if (G.effects.wallFlashes.length > 12) G.effects.wallFlashes.shift();
          G.effects.wallFlashes.push({ edgeIndex: edge.index, life: 0.42, maxLife: 0.42 });
          audio.wallBounce(power);
        }
        break;
      }
    }
  }

  function resolveCoinCollisions() {
    for (let i = 0; i < G.coins.length; i += 1) {
      const a = G.coins[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < G.coins.length; j += 1) {
        const b = G.coins[j];
        if (!b.alive) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minDist = a.radius + b.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minDist * minDist || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        const overlap = minDist - d;
        const protectedA = isFirstShotProtected(a);
        const protectedB = isFirstShotProtected(b);
        let invA = protectedA ? 0 : 1 / a.mass;
        let invB = protectedB ? 0 : 1 / b.mass;
        if (invA === 0 && invB === 0) {
          invA = 1 / a.mass;
          invB = 1 / b.mass;
        }
        const invSum = invA + invB;
        a.x -= nx * overlap * (invA / invSum) * 0.88;
        a.y -= ny * overlap * (invA / invSum) * 0.88;
        b.x += nx * overlap * (invB / invSum) * 0.88;
        b.y += ny * overlap * (invB / invSum) * 0.88;

        const rvx = b.vx - a.vx;
        const rvy = b.vy - a.vy;
        const along = rvx * nx + rvy * ny;
        if (along >= 0) continue;

        const aApproach = a.vx * nx + a.vy * ny;
        const bApproach = -(b.vx * nx + b.vy * ny);
        const closing = -along;
        const impulse = (1 + PHYS.restitution) * closing / invSum;
        const resistA = a.def.incomingResist || 1;
        const resistB = b.def.incomingResist || 1;
        a.vx -= impulse * invA * nx * resistA;
        a.vy -= impulse * invA * ny * resistA;
        b.vx += impulse * invB * nx * resistB;
        b.vy += impulse * invB * ny * resistB;

        // A touch of tangential friction makes glancing hits feel metallic.
        const tx = -ny;
        const ty = nx;
        const tangentSpeed = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty;
        const tangentImpulse = clamp(-tangentSpeed * 0.05, -impulse * 0.16, impulse * 0.16);
        a.vx -= tangentImpulse * invA * tx * resistA;
        a.vy -= tangentImpulse * invA * ty * resistA;
        b.vx += tangentImpulse * invB * tx * resistB;
        b.vy += tangentImpulse * invB * ty * resistB;

        // Red's 破阵: the aggressor transfers extra impulse to the defender.
        const contactX = a.x + nx * a.radius;
        const contactY = a.y + ny * a.radius;
        if (a.def.id === 'red' && aApproach > 30 && aApproach >= bApproach) {
          const bonus = closing * (a.def.impactBonus || 0.2) * resistB;
          b.vx += nx * bonus;
          b.vy += ny * bonus;
          if (closing > 260) {
            addFloatingText(contactX, contactY - 24, '破阵', '#ffd0d6', 10, 0.8);
            addWave(contactX, contactY, 24 + closing * 0.025, 'rgba(255,101,118,0.55)', 0.28, 1.1, false);
          }
        } else if (b.def.id === 'red' && bApproach > 30 && bApproach > aApproach) {
          const bonus = closing * (b.def.impactBonus || 0.2) * resistA;
          a.vx -= nx * bonus;
          a.vy -= ny * bonus;
          if (closing > 260) {
            addFloatingText(contactX, contactY - 24, '破阵', '#ffd0d6', 10, 0.8);
            addWave(contactX, contactY, 24 + closing * 0.025, 'rgba(255,101,118,0.55)', 0.28, 1.1, false);
          }
        }

        // Violet's 余弧: one small speed gain after its first collision of a shot.
        const violet = (a.def.id === 'violet' && !a.chainUsed) ? a
          : ((b.def.id === 'violet' && !b.chainUsed) ? b : null);
        if (violet && Math.hypot(violet.vx, violet.vy) > 45) {
          violet.vx *= 1.07;
          violet.vy *= 1.07;
          violet.chainUsed = true;
          addFloatingText(contactX, contactY - 40, '余弧', '#e6dcff', 10, 0.8);
          addSparks(contactX, contactY, 12, ['#b99aff', '#f0e7ff'], 280, Math.PI * 0.8, Math.atan2(-ny, -nx));
        }

        if ((a.def.id === 'moss' || b.def.id === 'moss') && closing > 320) {
          const moss = a.def.id === 'moss' ? a : b;
          const mossDefending = (moss === a && bApproach > aApproach)
            || (moss === b && aApproach > bApproach);
          if (mossDefending) {
            addFloatingText(moss.x, moss.y - moss.radius - 20, '苔甲', '#d9ffd9', 10, 0.8);
            addWave(moss.x, moss.y, moss.radius + 18, 'rgba(143,214,148,0.42)', 0.3, 1.1, false);
          }
        }

        if (protectedA) {
          a.vx = 0;
          a.vy = 0;
        }
        if (protectedB) {
          b.vx = 0;
          b.vy = 0;
        }

        a.spin -= tangentSpeed * 0.0012;
        b.spin += tangentSpeed * 0.0012;
        a.lastHitBy = b.id;
        b.lastHitBy = a.id;

        if (closing > 55) {
          a.flash = Math.max(a.flash, clamp(closing / 1200, 0.18, 0.95));
          b.flash = Math.max(b.flash, clamp(closing / 1200, 0.18, 0.95));
          a.squash = Math.max(a.squash, clamp(closing / 1500, 0.1, 0.8));
          b.squash = Math.max(b.squash, clamp(closing / 1500, 0.1, 0.8));
          onCoinCollision(a, b, nx, ny, closing);
        }
      }
    }
  }

  function onCoinCollision(a, b, nx, ny, closing) {
    const contactX = a.x + nx * a.radius;
    const contactY = a.y + ny * a.radius;
    const power = clamp(closing / 1500, 0, 1);
    G.stats.hits += 1;
    const now = G.time;
    if (now - G.combo.last < 1.15) G.combo.count += 1;
    else G.combo.count = 1;
    G.combo.last = now;
    G.combo.timer = 1.8;
    if (G.combo.count >= 2) {
      dom.comboBadge.querySelector('strong').textContent = `×${G.combo.count}`;
      dom.comboBadge.classList.add('is-visible');
    }

    const colors = [a.color, b.color, '#fff2c9'];
    addSparks(contactX, contactY, 14 + Math.round(power * 38), colors, 300 + power * 820);
    addWave(contactX, contactY, 16 + power * 22, 'rgba(255,250,235,0.95)', 0.12, 1, true);
    addWave(contactX, contactY, 38 + power * 112, rgba(mixColor(a.color, b.color, 0.5), 0.60 + power * 0.28), 0.36 + power * 0.34, 1.5 + power * 2.6, false);
    addPuff(contactX, contactY, 4 + Math.round(power * 10), rgba(mixColor(a.color, b.color, 0.5), 0.13), 50 + power * 130);
    addShake(1.4 + power * 15);
    if (power > 0.45) {
      flashScreen(mixColor(a.color, b.color, 0.5), 0.018 + power * 0.045);
    }
    if (power > 0.72) {
      G.slowmo = Math.max(G.slowmo, 0.075);
    }
    if (closing > 720) {
      addFloatingText(contactX, contactY - 42, '重击', '#ffe7a4', 15, 1.0);
    }
    audio.impact(closing);
    updateRoster();
  }

  function checkBoundaries(cause = 'edge') {
    const band = getArenaDangerBand();
    for (const coin of G.coins) {
      if (!coin.alive) continue;
      const boundaryDistance = distanceToArenaOpenBoundary(coin.x, coin.y);
      coin.danger = clamp((band - boundaryDistance) / band, 0, 1);
      if (!isInsideArena(coin.x, coin.y, coin.radius * 0.18)) {
        eliminateCoin(coin, cause);
      }
    }
  }

  function eliminateCoin(coin, cause = 'edge') {
    if (!coin.alive) return;
    const shrinkKill = cause === 'shrink';
    const angle = Math.atan2(coin.y, coin.x);
    const edge = getArenaBoundaryAtAngle(angle) || { x: coin.x, y: coin.y };
    const hx = edge.x;
    const hy = edge.y;
    const killer = !shrinkKill && coin.lastHitBy
      ? (G.coins.find((c) => c.id === coin.lastHitBy)?.def || participantDef(coin.lastHitBy))
      : null;
    const playerKill = !shrinkKill && coin.lastHitBy === G.playerId && coin.id !== G.playerId;

    coin.alive = false;
    coin.out = true;
    coin.fall = 0;
    coin.active = false;
    coin.marker = null;
    coin.aiRecallTimer = 0;
    coin.vx *= 0.42;
    coin.vy *= 0.42;
    G.alive = G.coins.filter((c) => c.alive).length;
    if (playerKill) G.stats.kos += 1;

    G.slowmo = Math.max(G.slowmo, 0.62);
    addShake(20);
    flashScreen(coin.id === G.playerId ? '255,95,112' : coin.rgb, 0.10);
    addWave(hx, hy, 155, 'rgba(255,95,112,0.55)', 0.8, 3.6);
    addWave(hx, hy, 78, rgba(coin.color, 0.85), 0.55, 1.5);
    addSparks(hx, hy, 40, ['#ff5f70', '#ffd166', coin.color, '#fff3cc'], 650, Math.PI * 1.3, angle);
    addPuff(hx, hy, 12, 'rgba(255,95,112,0.16)', 150);
    addFloatingText(hx, hy - 48, coin.id === G.playerId ? '你出局' : 'OUT', coin.id === G.playerId ? '#ff8a96' : '#ffe3ad', 18, 1.15);
    audio.eliminate();

    if (coin.id === G.playerId) {
      G.playerOut = true;
      addToast(
        shrinkKill
          ? `你的${coin.name}被收缩边界挤出 · 进入观战`
          : `你的${coin.name}出局 · 进入观战模式`,
        'out',
        3200,
      );
    } else if (shrinkKill) {
      addToast(`${coin.name} 被收缩边界挤出`, 'out', 2400);
    } else if (playerKill) {
      addToast(`击飞出局 · ${coin.name}`, 'out', 2400);
    } else {
      addToast(`${coin.name} 出局 · ${killer ? killer.name : '自行滑出'}`, 'out', 2400);
    }

    updateRoster();
    updateHUD(true);

    if (!G.pending) {
      const aliveCoins = G.coins.filter((c) => c.alive);
      if (aliveCoins.length === 1) {
        G.winnerId = aliveCoins[0].id;
        scheduleResult(aliveCoins[0].id === G.playerId ? 'win' : 'defeat', 1.5);
      }
    }
    if (coin === G.active && (G.phase === 'aiAim' || G.phase === 'playerAim')) {
      G.phase = 'resolve';
      G.resolve = { elapsed: 0, still: 0, delay: 0.6 };
      G.ai.plan = null;
      audio.stopCharge();
    }
    if (G.phase !== 'pending' && G.phase !== 'over') {
      G.resolve.delay = Math.max(G.resolve.delay, 0.55);
    }
    if (G.volley && G.phase === 'volleyAim') {
      const alive = G.coins.filter((c) => c.alive);
      G.volley.alive = alive.length;
      G.volley.locked = alive.filter((c) => c.locked).length;
      maybeStartVolleyFire();
    }
    // Re-render after the phase transition so the dock never keeps showing
    // "your turn" after the player has just been eliminated.
    updateHUD(true);
  }

  function updateOutCoins(dt) {
    for (const coin of G.coins) {
      if (coin.alive || coin.fall >= 1) continue;
      coin.fall = clamp(coin.fall + dt * 1.55, 0, 1);
      coin.x += coin.vx * dt;
      coin.y += coin.vy * dt;
      coin.vx *= Math.exp(-2.2 * dt);
      coin.vy *= Math.exp(-2.2 * dt);
      coin.rot += dt * 2.2;
    }
  }

  /* =========================================================
     Turn AI and resolve
     ========================================================= */
  function isAIControlledCoin(coin) {
    if (!coin) return false;
    if (G.online && G.online.active && G.online.controllers) {
      return G.online.controllers[coin.id] === 'ai';
    }
    return coin.id !== G.playerId;
  }

  function assignAIPersonalities() {
    if (G.online && G.online.active && G.online.role === 'guest') {
      G.coins.forEach((coin) => { coin.personality = null; });
      return;
    }
    const pool = G.personalityPool
      .map((id) => AI_PERSONALITIES.find((personality) => personality.id === id))
      .filter(Boolean);
    const choices = pool.length ? pool : AI_PERSONALITIES;
    G.coins.forEach((coin) => {
      if (!isAIControlledCoin(coin)) {
        coin.personality = null;
        return;
      }
      coin.personality = choices[Math.floor(Math.random() * choices.length)];
    });
  }

  function chooseAITarget(coin) {
    const targets = G.coins.filter((c) => c.alive && c.id !== coin.id);
    if (!targets.length) return null;
    const personality = coin.personality ? coin.personality.id : null;
    if (personality === 'greedy' || personality === 'rage') {
      let nearest = targets[0];
      let best = dist(coin, nearest);
      for (const candidate of targets) {
        const d = dist(coin, candidate);
        if (d < best) {
          best = d;
          nearest = candidate;
        }
      }
      return nearest;
    }
    if (personality === 'lazy' || personality === 'random' || personality === 'meow') {
      return targets[Math.floor(Math.random() * targets.length)];
    }
    if (personality === 'blackdog') {
      let target = targets[0];
      let best = -Infinity;
      for (const candidate of targets) {
        const d = dist(coin, candidate);
        const edge = Math.max(0, distanceToArenaOpenBoundary(candidate.x, candidate.y));
        let score = 170 - d * 0.048 + edge * 0.55 + (1.5 - candidate.mass) * 22;
        if (candidate.id === G.playerId) score += 22;
        if (edge < R * 0.2) score += 58;
        if (edge < R * 0.1) score += 82;
        if (isFirstShotProtected(candidate)) score -= 72;
        if (Math.hypot(candidate.vx, candidate.vy) > 90) score += 16;
        if (coin.def.id === 'azure' && edge > R * 0.12) score += 12;
        if (coin.def.id === 'amber' && edge > R * 0.16) score += 20;
        if (coin.def.id === 'rose' && edge < R * 0.28) score += 14;
        if (score > best) {
          best = score;
          target = candidate;
        }
      }
      return target;
    }
    const difficulty = getAIDifficulty();
    const smart = personality === 'smart';
    let best = null;
    let bestScore = -Infinity;
    targets.forEach((t) => {
      const d = dist(coin, t);
      const edge = Math.max(0, distanceToArenaOpenBoundary(t.x, t.y));
      let score = 100 - d * 0.075 - edge * 0.28;
      if (t.id === G.playerId) score += (10 + (coin.def.aggression || 0.5) * 10) * difficulty.playerBias * (smart ? 1.3 : 1);
      if (edge < R * 0.22) score += 55 * difficulty.edgeBias * (smart ? 1.35 : 1);
      if (edge < R * 0.11) score += 35 * difficulty.edgeBias * (smart ? 1.35 : 1);
      score += rand(-22, 22) * difficulty.noise * (smart ? 0.45 : 1);
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    });
    return best;
  }

  function makeAIPlan(coin) {
    const personality = coin.personality ? coin.personality.id : 'smart';
    let target = null;
    const aliveCoins = G.coins.filter((c) => c.alive).length;
    if (personality === 'steady' && aliveCoins >= 4) {
      target = {
        id: null,
        x: 0,
        y: 0,
        radius: 0,
        mass: 1,
        alive: true,
        isPoint: true,
      };
    } else {
      target = chooseAITarget(coin);
    }
    if (!target) return null;
    const difficulty = getAIDifficulty();
    const isBlackdog = personality === 'blackdog';
    const lead = isBlackdog ? 0.22 : 0.16;
    const ax = target.isPoint ? target.x : target.x + (target.vx || 0) * lead;
    const ay = target.isPoint ? target.y : target.y + (target.vy || 0) * lead;
    const dx = ax - coin.x;
    const dy = ay - coin.y;
    const d = Math.max(20, Math.hypot(dx, dy));
    let angle = Math.atan2(dy, dx);
    let aimError = difficulty.aimError;
    let blunderChance = difficulty.blunderChance;
    if (isBlackdog) {
      aimError *= 0.28;
      blunderChance *= 0.12;
    } else if (personality === 'smart') {
      aimError *= 0.62;
      blunderChance *= 0.4;
    } else if (personality === 'rage') {
      aimError *= 0.72;
      blunderChance *= 0.7;
    } else if (personality === 'lazy') {
      aimError *= 1.45;
      blunderChance *= 1.25;
    }
    const skill = coin.def.aiSkill || 0.045;
    angle += rand(-skill, skill) * aimError;
    angle += rand(-0.018, 0.018) * aimError;
    if (Math.random() < blunderChance) {
      angle += rand(-difficulty.blunderAmount, difficulty.blunderAmount);
    }
    if (personality === 'random') {
      angle = rand(0, TAU);
    } else if (personality === 'meow' && Math.random() < 0.32) {
      angle += rand(-0.55, 0.55);
    }
    const targetEdge = target.isPoint ? 0 : Math.max(0, distanceToArenaOpenBoundary(target.x, target.y));
    const desired = d + (target.radius || 0) * 1.5;
    const required = speedForDistance(desired) * (0.9 + (target.mass || 1) * 0.16);
    let power = (required - coin.def.launchMin) / (coin.def.launchMax - coin.def.launchMin);
    power += difficulty.powerMargin + rand(0, difficulty.powerRandom);
    if (targetEdge < R * 0.25) power += 0.1;
    if (Math.random() < difficulty.blunderChance) power += rand(-difficulty.powerRandom, difficulty.powerRandom);
    if (personality === 'lazy') power *= 0.54;
    else if (personality === 'rage') power += 0.13;
    else if (personality === 'smart') power += 0.035;
    else if (personality === 'random') power = rand(0.22, 1);
    else if (personality === 'meow') power *= rand(0.5, 1.16);
    else if (isBlackdog) {
      const coinId = coin.def.id;
      if (coinId === 'gold') power = Math.max(power, 0.76);
      else if (coinId === 'azure') {
        if (power <= 0.9) power = clamp(power, 0.5, 0.78);
      } else if (coinId === 'amber') {
        if (targetEdge < R * 0.3 || d < R * 0.36) power = Math.max(power, 0.92);
        else power = Math.min(power, 0.88);
      } else if (coinId === 'cyan') power *= 1.05;
      else if (coinId === 'red') power += 0.045;
      else if (coinId === 'rose') power += 0.035;
      else if (coinId === 'curve') power += 0.02;
      else if (coinId === 'moss') power += 0.03;
      power = clamp(power, 0.16, 1);
    }
    power = clamp(power, 0.12, 1);
    if (personality === 'meow' && Math.random() < 0.28) {
      addFloatingText(coin.x, coin.y - coin.radius - 16, '喵', '#ff86ad', 11, 0.9);
      audio.meow();
    }

    return {
      angle,
      power,
      target,
      targetId: target.id || null,
      personality,
    };
  }

  function updateAI(dt) {
    if (G.phase !== 'aiAim' || !G.active) return;
    G.ai.elapsed += dt;
    if (!G.ai.plan) {
      if (G.ai.elapsed >= G.ai.waiting) {
        G.ai.plan = makeAIPlan(G.active);
        if (!G.ai.plan) {
          G.ai.plan = {
            angle: rand(0, TAU),
            power: 0.7,
            target: null,
          };
        }
        G.ai.planned = true;
        G.aim.angle = G.ai.plan.angle;
        audio.startCharge();
        updateHUD(true);
      }
      return;
    }

    const aimT = clamp((G.ai.elapsed - G.ai.waiting) / (G.ai.aimDuration || 1.05), 0, 1);
    G.aim.angle = G.ai.plan.angle;
    G.aim.power = G.ai.plan.power * aimT;
    updatePowerUI();
    if (aimT >= 1) {
      const plan = G.ai.plan;
      fireCoin(G.active, plan.angle, plan.power);
    }
  }

  function updateResolve(dt) {
    if (G.phase !== 'resolve') return;
    G.resolve.elapsed += dt;
    let maxSpeed = 0;
    for (const coin of G.coins) {
      if (coin.alive) maxSpeed = Math.max(maxSpeed, Math.hypot(coin.vx, coin.vy));
    }
    for (const obstacle of G.obstacles) {
      if (obstacle.movable) maxSpeed = Math.max(maxSpeed, Math.hypot(obstacle.vx, obstacle.vy));
    }
    if (maxSpeed < 13) G.resolve.still += dt;
    else G.resolve.still = 0;

    if (G.pending) return;
    const ready = G.resolve.still > 0.42 || G.resolve.elapsed > 7.2;
    if (ready && G.resolve.elapsed > 0.72 + G.resolve.delay) {
      beginNextRound();
    }
  }

  function updateCombo(dt) {
    if (G.combo.timer > 0) {
      G.combo.timer -= dt;
      if (G.combo.timer <= 0) {
        dom.comboBadge.classList.remove('is-visible');
        G.combo.count = 0;
      }
    }
  }

  function updateSlowmo(dt) {
    G.slowmo = Math.max(0, G.slowmo - dt);
    const target = G.slowmo > 0 ? 0.3 : 1;
    G.timeScale = lerp(G.timeScale, target, 1 - Math.exp(-dt * (G.slowmo > 0 ? 12 : 5)));
  }

  /* =========================================================
     Main update
     ========================================================= */
  function update(dt) {
    if (G.chase) {
      updateChase(dt);
      return;
    }
    G.time += dt;
    G.pointer.worldX = screenToWorld(G.pointer.x, G.pointer.y).x;
    G.pointer.worldY = screenToWorld(G.pointer.x, G.pointer.y).y;

    updateAmbient(dt);
    updateKeyboardPan(dt);
    updateCamera(dt);

    if (G.phase === 'menu') {
      G.menuTime += dt;
      updateEffects(dt);
      G.coins.forEach((c, i) => {
        c.rot += dt * (0.08 + i * 0.012);
      });
      return;
    }

    if (G.paused || G.helpOpen || G.inspectOpen) {
      return;
    }

    if (G.phase === 'over') {
      updateSlowmo(dt);
      updateEffects(dt);
      return;
    }

    updateSlowmo(dt);
    updateEffects(dt * G.timeScale);
    const simDt = dt * G.timeScale;

    // The online guest only renders host-authoritative snapshots. It still
    // owns aim/charge locally when it is the guest's turn.
    if (G.online && G.online.role === 'guest' && G.online.active) {
      updateGuestOnlineTimer(dt);
      if (G.phase === 'playerAim' || (G.phase === 'volleyAim' && canPlayerAim())) {
        if (!G.online.shotSent) {
          updateAimFromPointer();
          if (G.aim.charging) {
            G.aim.chargeT += dt;
            G.aim.power = clamp(G.aim.chargeT / CHARGE_TIME, 0, 1);
            audio.updateCharge(G.aim.power);
          }
        }
        const dangerNow = activeDanger();
        if (dangerNow && !G.dangerNotified) {
          G.dangerNotified = true;
          addToast('边界警告 · 你的硬币已接近出界线', 'out', 2400);
        }
        if (!dangerNow) G.dangerNotified = false;
      }
      updateOnlineInterpolation(dt);
      updateCoinVisuals(simDt);
      G.uiTimer += dt;
      if (G.uiTimer > 0.055) {
        G.uiTimer = 0;
        updateDynamicHUD();
        updateRoster();
      }
      return;
    }

    if (G.online && G.online.active && G.online.role === 'host') {
      updateOnlineShotTimer(dt);
    }
    updateEchoAI(dt);
    updateAnchorAI(dt);

    if (G.phase === 'intro') {
      G.introT += dt;
      G.coins.forEach((coin, i) => {
        const d = coin.spawnDelay;
        const t = clamp((G.introT - d) / 0.58, 0, 1);
        coin.spawn = easeOutBack(t);
        if (t > 0.04 && coin.personality && coin.personality.id === 'blackdog'
          && !coin.blackdogFxTriggered) {
          triggerBlackdogEntrance(coin);
        }
      });
      if (G.introT >= 1.32) {
        beginNextRound();
      }
    } else {
      if (G.phase === 'playerAim') {
        updateAimFromPointer();
        if (G.aim.charging) {
          G.aim.chargeT += dt;
          G.aim.power = clamp(G.aim.chargeT / CHARGE_TIME, 0, 1);
          audio.updateCharge(G.aim.power);
        }
        const dangerNow = activeDanger();
        if (dangerNow && !G.dangerNotified) {
          G.dangerNotified = true;
          addToast('边界警告 · 你的硬币已接近出界线', 'out', 2400);
        }
        if (!dangerNow) G.dangerNotified = false;
      } else if (G.phase === 'volleyAim') {
        updateVolleyAim(dt);
        if (G.phase === 'volleyAim' && canPlayerAim()) {
          updateAimFromPointer();
          if (G.aim.charging) {
            G.aim.chargeT += dt;
            G.aim.power = clamp(G.aim.chargeT / CHARGE_TIME, 0, 1);
            audio.updateCharge(G.aim.power);
          }
          const dangerNow = activeDanger();
          if (dangerNow && !G.dangerNotified) {
            G.dangerNotified = true;
            addToast('边界警告 · 你的硬币已接近出界线', 'out', 2400);
          }
          if (!dangerNow) G.dangerNotified = false;
        }
      } else if (G.phase === 'aiAim') {
        updateAI(dt);
      }

      updatePhysics(simDt);
      updateOutCoins(simDt);
      checkBoundaries();

      if (G.phase === 'resolve') updateResolve(dt);
      if (G.phase === 'playerAim' || G.phase === 'volleyAim' || G.phase === 'aiAim' || G.phase === 'resolve') {
        updateCoinVisuals(simDt);
      }

      G.stats.elapsed += dt;
    }

    updateCombo(dt);

    if (G.pending) {
      G.pending.timer -= dt;
      if (G.pending.timer <= 0) {
        const result = G.pending.result;
        G.pending = null;
        finishGame(result);
      }
    }

    G.uiTimer += dt;
    if (G.uiTimer > 0.055) {
      G.uiTimer = 0;
      updateDynamicHUD();
      updateRoster();
    }
  }

  function updateOnlineInterpolation(dt) {
    for (const coin of G.coins) {
      if (!coin.alive) {
        coin.x = coin.targetX ?? coin.x;
        coin.y = coin.targetY ?? coin.y;
        continue;
      }
      if (coin.syncT < 1) {
        coin.syncT = Math.min(1, coin.syncT + dt / 0.075);
        const t = 1 - (1 - coin.syncT) * (1 - coin.syncT);
        coin.x = coin.prevX + (coin.targetX - coin.prevX) * t;
        coin.y = coin.prevY + (coin.targetY - coin.prevY) * t;
      } else {
        coin.x = coin.targetX ?? coin.x;
        coin.y = coin.targetY ?? coin.y;
      }
    }
  }

  function updateCoinVisuals(dt) {
    for (const coin of G.coins) {
      if (!coin.alive) continue;
      const speed = Math.hypot(coin.vx, coin.vy);
      coin.speed = speed;
      coin.flash *= Math.exp(-dt * 7.5);
      coin.squash *= Math.exp(-dt * 6);
      if (speed > 220) {
        coin.trailT += dt;
        if (coin.trailT > 0.018) {
          coin.trailT = 0;
          coin.trail.push({ x: coin.x, y: coin.y, life: 0.24 });
          if (coin.trail.length > 16) coin.trail.shift();
        }
        coin.dustT += dt;
        if (speed > 520 && coin.dustT > 0.09) {
          coin.dustT = 0;
          addPuff(
            coin.x - (coin.vx / speed) * coin.radius * 0.7,
            coin.y - (coin.vy / speed) * coin.radius * 0.7,
            1,
            rgba(coin.color, 0.055),
            12,
          );
        }
      } else {
        coin.trailT = 0;
        coin.dustT = 0;
      }
      if (coin.def.id === 'curve' && coin.curveActive && speed > 60) {
        coin.curveTrailT += dt;
        if (coin.curveTrailT > 0.012) {
          coin.curveTrailT = 0;
          coin.curveTrail.push({
            x: coin.x,
            y: coin.y,
            life: 0.46,
            max: 0.46,
            angle: Math.atan2(coin.vy, coin.vx),
            speed,
          });
          if (coin.curveTrail.length > 28) coin.curveTrail.shift();
        }
      } else {
        coin.curveTrailT = 0;
      }
      if (coin.curveTrail && coin.curveTrail.length) {
        for (let i = coin.curveTrail.length - 1; i >= 0; i -= 1) {
          coin.curveTrail[i].life -= dt;
          if (coin.curveTrail[i].life <= 0) coin.curveTrail.splice(i, 1);
        }
      }
      for (let i = coin.trail.length - 1; i >= 0; i -= 1) {
        coin.trail[i].life -= dt;
        if (coin.trail[i].life <= 0) coin.trail.splice(i, 1);
      }
    }
  }

  /* =========================================================
     Rendering
     ========================================================= */
  function drawChaseFloor() {
    const R = CHASE_RADIUS;
    const gradient = ctx.createRadialGradient(0, 0, R * 0.08, 0, 0, R);
    gradient.addColorStop(0, '#0d2b2f');
    gradient.addColorStop(0.62, '#081c20');
    gradient.addColorStop(1, '#040d0f');
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = 'rgba(92, 224, 207, 0.3)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(92, 224, 207, 0.065)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 9; i += 1) {
      ctx.beginPath();
      ctx.arc(0, 0, (R / 9) * i, 0, TAU);
      ctx.stroke();
    }
    for (let i = 0; i < 24; i += 1) {
      const angle = (i / 24) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * 66, Math.sin(angle) * 66);
      ctx.lineTo(Math.cos(angle) * R, Math.sin(angle) * R);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawChaseWalls() {
    const cam = G.camera;
    const margin = 90;
    const view = {
      left: cam.x - G.width / (2 * cam.zoom) - margin,
      right: cam.x + G.width / (2 * cam.zoom) + margin,
      top: cam.y - G.height / (2 * cam.zoom) - margin,
      bottom: cam.y + G.height / (2 * cam.zoom) + margin,
    };
    ctx.save();
    for (const wall of G.chase.maze.walls) {
      if (wall.x + wall.w < view.left || wall.x > view.right
        || wall.y + wall.h < view.top || wall.y > view.bottom) continue;
      const radius = 3;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') ctx.roundRect(wall.x, wall.y, wall.w, wall.h, radius);
      else ctx.rect(wall.x, wall.y, wall.w, wall.h);
      ctx.fillStyle = '#123538';
      ctx.fill();
      ctx.strokeStyle = 'rgba(116, 239, 220, 0.42)';
      ctx.lineWidth = 1.3;
      ctx.stroke();
      if (wall.w > 28) {
        ctx.strokeStyle = 'rgba(190, 255, 244, 0.17)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(wall.x + 5, wall.y + 2.5);
        ctx.lineTo(wall.x + wall.w - 5, wall.y + 2.5);
        ctx.stroke();
      } else if (wall.h > 28) {
        ctx.strokeStyle = 'rgba(190, 255, 244, 0.14)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(wall.x + 2.5, wall.y + 5);
        ctx.lineTo(wall.x + 2.5, wall.y + wall.h - 5);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawChaseExit() {
    const ch = G.chase;
    const exit = ch.exit;
    const pulse = 0.5 + Math.sin(G.time * 3.6) * 0.5;
    ctx.save();
    ctx.translate(exit.x, exit.y);
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(0, 0, 4, 0, 0, 78 + pulse * 16);
    glow.addColorStop(0, 'rgba(115,255,224,0.3)');
    glow.addColorStop(0.45, 'rgba(73,211,194,0.12)');
    glow.addColorStop(1, 'rgba(73,211,194,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 94 + pulse * 16, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = `rgba(163, 255, 236, ${0.58 + pulse * 0.3})`;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(0, 0, exit.r + 7 + pulse * 3, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([4, 7]);
    ctx.lineDashOffset = -G.time * 22;
    ctx.strokeStyle = 'rgba(129, 239, 219, 0.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, exit.r + 19, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(6, 25, 24, 0.84)';
    ctx.beginPath();
    ctx.arc(0, 0, exit.r - 2, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(171, 255, 237, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, exit.r - 5, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = 'rgba(192, 255, 241, 0.92)';
    ctx.font = '700 9px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('EXIT', 0, 3);
    ctx.restore();
  }

  function drawChaseTrails() {
    const ch = G.chase;
    const all = [{ entity: ch.player, color: ch.player.def.color }, ...ch.enemies.map((e) => ({ entity: e, color: e.def.color }))];
    ctx.save();
    for (const { entity, color } of all) {
      if (!entity.trail || !entity.trail.length) continue;
      for (let i = 0; i < entity.trail.length; i += 1) {
        const point = entity.trail[i];
        const alpha = clamp(point.life / point.max, 0, 1) * 0.22;
        ctx.fillStyle = rgba(color, alpha);
        ctx.beginPath();
        ctx.arc(point.x, point.y, Math.max(1, entity.r * 0.22 * alpha * 2.4), 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawChaseCoin(entity, isPlayer) {
    const r = entity.r;
    const def = entity.def;
    const invulnBlink = isPlayer && G.chase.invuln > 0
      ? 0.48 + Math.sin(G.time * 24) * 0.25
      : 1;
    ctx.save();
    ctx.translate(entity.x, entity.y);
    ctx.globalAlpha = invulnBlink;
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    ctx.beginPath();
    ctx.ellipse(2, r * 0.55, r * 0.95, r * 0.45, 0, 0, TAU);
    ctx.fill();
    if (isPlayer) {
      ctx.strokeStyle = `rgba(113, 236, 217, ${0.3 + Math.sin(G.time * 3) * 0.1})`;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(0, 0, r + 13, 0, TAU);
      ctx.stroke();
    }
    if (!isPlayer) {
      ctx.strokeStyle = rgba(entity.role ? '#ff8b99' : def.color, 0.38);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, 0, r + 8 + (entity.flash || 0) * 5, 0, TAU);
      ctx.stroke();
    }
    ctx.rotate(entity.rot || 0);
    const body = ctx.createRadialGradient(-r * 0.36, -r * 0.42, r * 0.08, 0, 0, r * 1.12);
    body.addColorStop(0, def.faceLight);
    body.addColorStop(0.33, def.color);
    body.addColorStop(0.76, def.faceMid);
    body.addColorStop(1, def.faceDark);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = rgba(def.faceLight, 0.6);
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.strokeStyle = rgba(def.faceDark, 0.55);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.79, 0, TAU);
    ctx.stroke();
    drawEmblem(ctx, def.emblem, r * 0.47, def.faceDark);
    if (entity.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${entity.flash * 0.4})`;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    if (!isPlayer) {
      ctx.save();
      ctx.font = '600 9px "Bahnschrift", "Microsoft YaHei UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = rgba(def.faceLight, 0.9);
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 5;
      ctx.fillText(entity.role ? entity.role.name : '追兵', entity.x, entity.y - r - 13);
      ctx.restore();
    } else {
      ctx.save();
      ctx.font = '700 9px "Bahnschrift", "Microsoft YaHei UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#eafffa';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 5;
      ctx.fillText('你', entity.x, entity.y - r - 14);
      ctx.restore();
    }
  }

  function drawChaseAim() {
    const ch = G.chase;
    if (!ch || ch.over) return;
    if (!canChaseAim() && !G.aim.charging) return;
    const player = ch.player;
    const power = G.aim.charging ? G.aim.power : 0;
    const length = 96 + power * 250;
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(G.aim.angle);
    ctx.globalAlpha = G.aim.charging ? 0.85 : 0.42;
    ctx.strokeStyle = G.aim.charging ? 'rgba(255,225,159,0.9)' : 'rgba(129,239,219,0.7)';
    ctx.lineWidth = G.aim.charging ? 1.7 : 1;
    ctx.setLineDash([7, 8]);
    ctx.lineDashOffset = -G.time * 30;
    ctx.beginPath();
    ctx.moveTo(player.r + 12, 0);
    ctx.lineTo(length, 0);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(length, 0);
    ctx.lineTo(length - 10, -6);
    ctx.lineTo(length - 10, 6);
    ctx.closePath();
    ctx.fillStyle = G.aim.charging ? 'rgba(255,225,159,0.95)' : 'rgba(129,239,219,0.7)';
    ctx.fill();
    if (G.aim.charging) {
      ctx.strokeStyle = 'rgba(255,225,159,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, player.r + 15, -Math.PI / 2, -Math.PI / 2 + Math.max(0.02, power) * TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawChaseCursor() {
    if (!G.chase || G.phase !== 'chase' || G.resultOpen || G.helpOpen || !G.pointer.inside) return;
    const canAim = canChaseAim();
    const charging = G.aim.charging;
    const power = charging ? G.aim.power : 0;
    const color = charging ? '#ffe09e' : (canAim ? '#83efdc' : '#7d918c');
    const x = G.pointer.x;
    const y = G.pointer.y;
    const pulse = 0.5 + Math.sin(G.time * 5.5) * 0.5;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = canAim ? 0.96 : 0.58;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.3;
    ctx.shadowColor = color;
    ctx.shadowBlur = charging ? 14 : 7;
    ctx.beginPath();
    ctx.arc(0, 0, 10 + power * 3, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha *= 0.8;
    ctx.setLineDash([3, 5]);
    ctx.lineDashOffset = -G.time * 24;
    ctx.beginPath();
    ctx.arc(0, 0, 17 + pulse * 2 + power * 4, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = canAim ? 0.95 : 0.55;
    for (let i = 0; i < 4; i += 1) {
      const angle = i * Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * 6, Math.sin(angle) * 6);
      ctx.lineTo(Math.cos(angle) * 13, Math.sin(angle) * 13);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0 - 21, 2, 0, TAU);
    ctx.fill();
    if (charging) {
      ctx.lineWidth = 2.2;
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.arc(0, 0, 22, -Math.PI / 2, -Math.PI / 2 + Math.max(0.02, power) * TAU);
      ctx.stroke();
    }
    ctx.shadowBlur = 5;
    ctx.globalAlpha = 0.9;
    ctx.font = '600 9px "JetBrains Mono", "Microsoft YaHei UI", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const label = charging ? `蓄力 ${Math.round(power * 100)}%` : (canAim ? '弹射' : '滑行中');
    ctx.fillText(label, 0, 29);
    ctx.restore();
  }

  function renderChase() {
    const dpr = G.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, G.width, G.height);
    drawScreenAmbient();
    const cam = G.camera;
    ctx.save();
    ctx.translate(G.width / 2 + cam.shakeX, G.height / 2 + cam.shakeY);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);
    drawChaseFloor();
    drawChaseWalls();
    drawChaseExit();
    drawChaseAim();
    drawChaseTrails();
    drawWaves(false);
    G.chase.enemies.forEach((enemy) => drawChaseCoin(enemy, false));
    drawChaseCoin(G.chase.player, true);
    drawWaves(true);
    drawParticles();
    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawFloatingTexts();
    drawScreenFlash();
    drawChaseCursor();
  }

  function obstaclePoints(obstacle) {
    const shape = OBSTACLE_SHAPES[obstacle.shape];
    if (!shape || !shape.sides) return [];
    if (shape.rectangle) {
      const halfWidth = obstacle.radius * 0.92;
      const halfHeight = obstacle.radius * 0.52;
      return [
        { x: -halfWidth, y: -halfHeight },
        { x: halfWidth, y: -halfHeight },
        { x: halfWidth, y: halfHeight },
        { x: -halfWidth, y: halfHeight },
      ];
    }
    const points = [];
    for (let i = 0; i < shape.sides; i += 1) {
      const angle = -Math.PI / 2 + (i / shape.sides) * TAU;
      points.push({
        x: Math.cos(angle) * obstacle.radius,
        y: Math.sin(angle) * obstacle.radius,
      });
    }
    return points;
  }

  function traceObstacleShape(c, obstacle, scale = 1) {
    c.beginPath();
    if (obstacle.shape === 'circle') {
      c.arc(0, 0, obstacle.radius * scale, 0, TAU);
      return;
    }
    const points = obstaclePoints(obstacle);
    points.forEach((point, index) => {
      if (index === 0) c.moveTo(point.x * scale, point.y * scale);
      else c.lineTo(point.x * scale, point.y * scale);
    });
    c.closePath();
  }

  function drawObstacles() {
    if (!G.obstacles.length) return;
    const time = G.time;
    for (const obstacle of G.obstacles) {
      const movable = obstacle.movable;
      const color = movable ? '#ffc46b' : '#7fe7d8';
      const inner = movable ? '#5a3b1c' : '#123f43';
      const flash = clamp(obstacle.flash || 0, 0, 1);
      ctx.save();
      ctx.translate(obstacle.x, obstacle.y);
      ctx.rotate(obstacle.rot);
      ctx.shadowColor = movable ? 'rgba(255, 176, 82, 0.34)' : 'rgba(80, 231, 212, 0.28)';
      ctx.shadowBlur = 18 + flash * 20;
      const fill = ctx.createRadialGradient(
        -obstacle.radius * 0.3,
        -obstacle.radius * 0.38,
        obstacle.radius * 0.08,
        0,
        0,
        obstacle.radius * 1.18,
      );
      fill.addColorStop(0, movable ? '#805527' : '#1d5e60');
      fill.addColorStop(0.62, inner);
      fill.addColorStop(1, movable ? '#2b1a0c' : '#071b1e');
      traceObstacleShape(ctx, obstacle);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = rgba(color, 0.82);
      ctx.lineWidth = 2.2;
      traceObstacleShape(ctx, obstacle);
      ctx.stroke();
      ctx.strokeStyle = rgba(color, 0.22);
      ctx.lineWidth = 1;
      traceObstacleShape(ctx, obstacle, 0.72);
      ctx.stroke();

      if (movable) {
        ctx.strokeStyle = rgba('#ffdc9a', 0.72);
        ctx.lineWidth = 1.4;
        ctx.setLineDash([3, 4]);
        ctx.lineDashOffset = -time * 22;
        ctx.beginPath();
        ctx.arc(0, 0, obstacle.radius + 7, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = rgba('#ffe4ad', 0.82);
        ctx.beginPath();
        ctx.arc(-obstacle.radius * 0.24, 0, 2.2, 0, TAU);
        ctx.arc(obstacle.radius * 0.24, 0, 2.2, 0, TAU);
        ctx.fill();
      } else {
        ctx.strokeStyle = rgba('#b9fff5', 0.75);
        ctx.lineWidth = 1.4;
        const s = obstacle.radius * 0.36;
        ctx.beginPath();
        ctx.moveTo(-s, -s);
        ctx.lineTo(s, s);
        ctx.moveTo(s, -s);
        ctx.lineTo(-s, s);
        ctx.stroke();
      }
      if (flash > 0.02) {
        ctx.globalAlpha = flash * 0.4;
        ctx.fillStyle = '#fff4d2';
        traceObstacleShape(ctx, obstacle);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawObstaclePreview(cx, cy, radius) {
    if (!G.arenaObstaclePreview) {
      G.arenaObstaclePreview = buildObstacleLayout(radius, G.arena.obstacles, { preview: true });
    }
    for (const obstacle of G.arenaObstaclePreview) {
      const index = G.arenaObstaclePreview.indexOf(obstacle);
      const selected = G.arena.obstacles.placement === 'custom'
        && index === G.arenaObstacleSelected;
      const movable = obstacle.movable;
      const color = movable ? '#ffc46b' : '#7fe7d8';
      previewCtx.save();
      previewCtx.translate(cx + obstacle.x, cy + obstacle.y);
      previewCtx.rotate(obstacle.rot);
      traceObstacleShape(previewCtx, obstacle);
      previewCtx.fillStyle = movable ? 'rgba(82, 51, 20, 0.9)' : 'rgba(16, 62, 64, 0.92)';
      previewCtx.fill();
      previewCtx.strokeStyle = selected ? '#fff0b8' : rgba(color, 0.8);
      previewCtx.lineWidth = selected ? 2.6 : 1.5;
      if (selected) {
        previewCtx.shadowColor = '#ffe09e';
        previewCtx.shadowBlur = 12;
      }
      traceObstacleShape(previewCtx, obstacle);
      previewCtx.stroke();
      previewCtx.shadowBlur = 0;
      if (movable) {
        previewCtx.strokeStyle = rgba('#ffdc9a', 0.66);
        previewCtx.setLineDash([2, 3]);
        previewCtx.beginPath();
        previewCtx.arc(0, 0, obstacle.radius + 5, 0, TAU);
        previewCtx.stroke();
        previewCtx.setLineDash([]);
      }
      if (selected) {
        previewCtx.strokeStyle = 'rgba(255, 240, 184, 0.55)';
        previewCtx.lineWidth = 1;
        previewCtx.beginPath();
        previewCtx.arc(0, 0, obstacle.radius + 10, 0, TAU);
        previewCtx.stroke();
      }
      previewCtx.restore();
    }
  }

  function render() {
    if (G.chase) {
      renderChase();
      return;
    }
    const dpr = G.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, G.width, G.height);
    drawScreenAmbient();

    const cam = G.camera;
    ctx.save();
    ctx.translate(G.width / 2 + cam.shakeX, G.height / 2 + cam.shakeY);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);

    drawArenaGlow();
    drawArenaFloor();
    drawArenaBoundary();
    drawArenaDust();
    drawObstacles();
    drawAimPreview();
    drawEchoMarkers();
    drawWaves(false);
    drawBlackdogEntrances();
    drawCurveTrails();
    drawCoinTrails();
    drawCoins();
    drawWaves(true);
    drawParticles();

    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    drawFloatingTexts();
    drawCoinLabels();
    drawOffscreenIndicator();
    drawScreenFlash();
    drawCursor();
  }

  function drawScreenAmbient() {
    for (const p of G.ambient) {
      const alpha = p.a * (0.65 + Math.sin(p.phase) * 0.35);
      ctx.fillStyle = `rgba(154, 235, 221, ${alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.fill();
    }
    // Faint diagonal telemetry lines in the margins.
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = 'rgba(90, 200, 185, 0.22)';
    ctx.lineWidth = 0.7;
    for (let i = 0; i < 3; i += 1) {
      const x = G.width * 0.06 + i * 17;
      ctx.beginPath();
      ctx.moveTo(x, G.height * 0.08);
      ctx.lineTo(x + G.height * 0.1, G.height * 0.3);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawArenaGlow() {
    const pulse = 0.5 + Math.sin(G.time * 0.7) * 0.5;
    ctx.save();

    const g = ctx.createRadialGradient(0, 0, R * 0.92, 0, 0, R * 1.34);
    g.addColorStop(0, `rgba(59, 211, 191, ${0.045 + pulse * 0.012})`);
    g.addColorStop(0.42, 'rgba(32, 147, 138, 0.035)');
    g.addColorStop(1, 'rgba(3, 8, 9, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, R * 1.36, 0, TAU);
    ctx.fill();

    // A dark drop shadow that hugs whichever shape is in play.
    ctx.save();
    traceArenaPath(ctx);
    ctx.fillStyle = 'rgba(2, 7, 8, 0.58)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 58;
    ctx.fill();
    ctx.restore();

    ctx.save();
    traceArenaPath(ctx);
    ctx.strokeStyle = 'rgba(80, 231, 212, 0.042)';
    ctx.lineWidth = 34;
    ctx.shadowColor = 'rgba(80, 231, 212, 0.24)';
    ctx.shadowBlur = 46;
    ctx.stroke();
    ctx.restore();

    // Broken orbital rings outside the playfield.
    ctx.lineWidth = 1;
    for (let i = 0; i < 2; i += 1) {
      const rr = R + 64 + i * 48;
      ctx.strokeStyle = i === 0 ? 'rgba(80, 231, 212, 0.09)' : 'rgba(255, 209, 102, 0.055)';
      ctx.setLineDash(i === 0 ? [1, 12] : [22, 17]);
      ctx.beginPath();
      ctx.arc(0, 0, rr, G.time * (0.012 + i * 0.006) + i, G.time * (0.012 + i * 0.006) + i + Math.PI * 1.55);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawArenaFloor() {
    if (!G.texture) return;
    const t = G.texture;
    ctx.save();
    clipArenaPath(ctx);
    ctx.globalAlpha = 0.98;
    ctx.drawImage(t.canvas, -t.extent, -t.extent, t.extent * 2, t.extent * 2);

    const light = ctx.createRadialGradient(-90, -120, 10, 0, 0, R * 0.94);
    light.addColorStop(0, 'rgba(98, 232, 211, 0.07)');
    light.addColorStop(0.54, 'rgba(73, 181, 168, 0.028)');
    light.addColorStop(1, 'rgba(4, 12, 14, 0)');
    ctx.fillStyle = light;
    ctx.fillRect(-R, -R, R * 2, R * 2);

    // Inner shadow along the shape edge.
    const shadowWidth = 46 + R * 0.08;
    traceArenaPath(ctx);
    ctx.strokeStyle = 'rgba(1, 5, 6, 0.36)';
    ctx.lineWidth = shadowWidth;
    ctx.stroke();
    traceArenaPath(ctx);
    ctx.strokeStyle = 'rgba(2, 7, 8, 0.34)';
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.restore();
  }

  function drawBoundaryTicks(verts, bs) {
    if (!verts) {
      for (let i = 0; i < 96; i += 1) {
        const a = i / 96 * TAU;
        const major = i % 8 === 0;
        const r1 = R - (major ? 16 : 9) * bs;
        const r2 = R - 4 * bs;
        ctx.strokeStyle = major ? 'rgba(255, 209, 102, 0.52)' : 'rgba(193, 255, 246, 0.22)';
        ctx.lineWidth = major ? 1.5 : 0.8;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
        ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
        ctx.stroke();
      }
      return;
    }

    const edges = [];
    let total = 0;
    for (let i = 0; i < verts.length; i += 1) {
      const a = verts[i];
      const b = verts[(i + 1) % verts.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      let nx = -(b.y - a.y) / (len || 1);
      let ny = (b.x - a.x) / (len || 1);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      if (nx * mx + ny * my < 0) {
        nx = -nx;
        ny = -ny;
      }
      edges.push({ a, b, len, nx, ny, start: total });
      total += len;
    }

    for (let i = 0; i < 96; i += 1) {
      const along = (i / 96) * total;
      const edge = edges.find((e) => along >= e.start && along <= e.start + e.len) || edges[edges.length - 1];
      const u = clamp((along - edge.start) / edge.len, 0, 1);
      const px = edge.a.x + (edge.b.x - edge.a.x) * u;
      const py = edge.a.y + (edge.b.y - edge.a.y) * u;
      const major = i % 8 === 0;
      const tickLen = (major ? 16 : 9) * bs;
      ctx.strokeStyle = major ? 'rgba(255, 209, 102, 0.52)' : 'rgba(193, 255, 246, 0.22)';
      ctx.lineWidth = major ? 1.5 : 0.8;
      ctx.beginPath();
      ctx.moveTo(px - edge.nx * 4 * bs, py - edge.ny * 4 * bs);
      ctx.lineTo(px - edge.nx * (4 * bs + tickLen), py - edge.ny * (4 * bs + tickLen));
      ctx.stroke();
    }
  }

  function drawWallSegments(bs) {
    const walls = getArenaEdges().filter((edge) => edge.isWall);
    if (!walls.length) return;
    ctx.save();
    ctx.lineCap = 'round';
    for (const edge of walls) {
      const flash = G.effects.wallFlashes.find((item) => item.edgeIndex === edge.index);
      const flashAlpha = flash ? clamp(flash.life / flash.maxLife, 0, 1) : 0;
      const a = edge.a;
      const b = edge.b;
      ctx.save();
      ctx.strokeStyle = `rgba(255, 178, 70, ${0.18 + flashAlpha * 0.18})`;
      ctx.lineWidth = 18 * bs;
      ctx.shadowColor = 'rgba(255, 178, 70, 0.55)';
      ctx.shadowBlur = 24;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = `rgba(255, 209, 102, ${0.72 + flashAlpha * 0.25})`;
      ctx.lineWidth = (8 + flashAlpha * 3) * bs;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255, 247, 211, ${0.72 + flashAlpha * 0.28})`;
      ctx.lineWidth = (1.8 + flashAlpha * 0.8) * bs;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();

      // Inner rail and cross-hatching make the wall read as a solid surface.
      const inset = 8 * bs;
      ctx.strokeStyle = `rgba(255, 217, 139, ${0.24 + flashAlpha * 0.2})`;
      ctx.lineWidth = 1.1 * bs;
      ctx.beginPath();
      ctx.moveTo(a.x - edge.nx * inset, a.y - edge.ny * inset);
      ctx.lineTo(b.x - edge.nx * inset, b.y - edge.ny * inset);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255, 214, 130, ${0.2 + flashAlpha * 0.24})`;
      ctx.lineWidth = 0.9 * bs;
      for (let d = 10; d < edge.len; d += 22) {
        const px = a.x + (edge.ex / edge.len) * d;
        const py = a.y + (edge.ey / edge.len) * d;
        ctx.beginPath();
        ctx.moveTo(px - edge.nx * 2, py - edge.ny * 2);
        ctx.lineTo(px - edge.nx * 13 * bs, py - edge.ny * 13 * bs);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawArenaBoundary() {
    const t = G.time;
    const bs = clamp(R / ARENA_BASE_RADIUS, 0.7, 1.6);
    const verts = getArenaVertices(R);
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    traceArenaPath(ctx);
    ctx.shadowColor = 'rgba(80, 231, 212, 0.42)';
    ctx.shadowBlur = 28;
    ctx.strokeStyle = 'rgba(80, 231, 212, 0.055)';
    ctx.lineWidth = 20 * bs;
    ctx.stroke();
    ctx.shadowBlur = 0;

    if (ctx.createConicGradient) {
      const cg = ctx.createConicGradient(t * 0.07, 0, 0);
      cg.addColorStop(0, 'rgba(80, 231, 212, 0.20)');
      cg.addColorStop(0.13, 'rgba(198, 255, 246, 0.75)');
      cg.addColorStop(0.26, 'rgba(80, 231, 212, 0.28)');
      cg.addColorStop(0.44, 'rgba(255, 209, 102, 0.40)');
      cg.addColorStop(0.52, 'rgba(80, 231, 212, 0.76)');
      cg.addColorStop(0.67, 'rgba(80, 231, 212, 0.20)');
      cg.addColorStop(0.82, 'rgba(255, 209, 102, 0.46)');
      cg.addColorStop(1, 'rgba(80, 231, 212, 0.20)');
      ctx.strokeStyle = cg;
    } else {
      ctx.strokeStyle = 'rgba(80, 231, 212, 0.58)';
    }
    traceArenaPath(ctx);
    ctx.lineWidth = 5.5 * bs;
    ctx.stroke();

    traceArenaPath(ctx);
    ctx.strokeStyle = 'rgba(210, 255, 248, 0.72)';
    ctx.lineWidth = 1.1 * bs;
    ctx.stroke();

    // Moving dashed highlights travel around either a circle or a polygon.
    ctx.setLineDash([7 * bs, 42 * bs]);
    ctx.lineDashOffset = -t * 36 * bs;
    ctx.strokeStyle = 'rgba(210, 255, 248, 0.34)';
    ctx.lineWidth = 2.1 * bs;
    traceArenaPath(ctx);
    ctx.stroke();
    ctx.setLineDash([3 * bs, 68 * bs]);
    ctx.lineDashOffset = -t * 17 * bs;
    ctx.strokeStyle = 'rgba(255, 209, 102, 0.32)';
    ctx.lineWidth = 2.6 * bs;
    traceArenaPath(ctx);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    if (verts) {
      verts.forEach((v) => {
        ctx.fillStyle = 'rgba(255, 222, 145, 0.52)';
        ctx.beginPath();
        ctx.arc(v.x, v.y, 2.4 * bs, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 209, 102, 0.18)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(v.x, v.y, 8 * bs, 0, TAU);
        ctx.stroke();
      });
    }

    drawBoundaryTicks(verts, bs);
    drawWallSegments(bs);

    if (G.shrinkFlash > 0) {
      const a = G.shrinkFlash;
      ctx.save();
      traceArenaPath(ctx);
      ctx.strokeStyle = `rgba(255, 166, 96, ${a * 0.7})`;
      ctx.lineWidth = (7 + a * 9) * bs;
      ctx.shadowColor = 'rgba(255, 146, 82, 0.75)';
      ctx.shadowBlur = 34;
      ctx.stroke();
      ctx.restore();
    }

    // Inner danger track.
    ctx.setLineDash([2, 12]);
    ctx.lineDashOffset = -t * 10;
    ctx.strokeStyle = 'rgba(255, 95, 112, 0.13)';
    ctx.lineWidth = 1.3;
    traceArenaPath(ctx, R - 48);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    // Danger markers glow on the nearest open boundary.
    for (const coin of G.coins) {
      if (!coin.alive || coin.danger < 0.04) continue;
      const edge = getNearestOpenBoundary(coin.x, coin.y);
      if (!edge) continue;
      const intensity = coin.danger;
      const pulse = 0.55 + 0.45 * Math.sin(t * 5.5 + coin.rot);
      const halfLen = (20 + intensity * 28) * bs;
      ctx.strokeStyle = `rgba(255, 95, 112, ${0.16 + intensity * 0.6 * pulse})`;
      ctx.lineWidth = 5 * bs;
      ctx.shadowColor = 'rgba(255, 60, 84, 0.7)';
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.moveTo(edge.x - edge.tx * halfLen, edge.y - edge.ty * halfLen);
      ctx.lineTo(edge.x + edge.tx * halfLen, edge.y + edge.ty * halfLen);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255, 120, 132, ${0.24 + intensity * 0.5 * pulse})`;
      ctx.lineWidth = 1.4 * bs;
      ctx.beginPath();
      ctx.moveTo(edge.x, edge.y);
      ctx.lineTo(edge.x - edge.nx * 14 * bs, edge.y - edge.ny * 14 * bs);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Cardinal micro marks.
    ctx.fillStyle = 'rgba(161, 234, 223, 0.30)';
    ctx.font = '500 8px "Cascadia Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labels = ['N', 'E', 'S', 'W'];
    for (let i = 0; i < 4; i += 1) {
      const a = -Math.PI / 2 + i * Math.PI / 2;
      const edge = getArenaBoundaryAtAngle(a);
      if (edge) {
        ctx.fillText(labels[i], edge.x + edge.nx * 22, edge.y + edge.ny * 22);
      }
    }
    ctx.restore();
  }

  function drawArenaDust() {
    ctx.save();
    clipArenaPath(ctx);
    for (const p of G.arenaDust) {
      const alpha = p.a * (0.5 + 0.5 * Math.sin(G.time * 0.7 + p.phase));
      const drift = Math.sin(G.time * 0.24 * p.drift + p.phase) * 8;
      ctx.fillStyle = `rgba(177, 248, 235, ${alpha})`;
      ctx.beginPath();
      ctx.arc(p.x + drift, p.y - Math.cos(G.time * 0.2 + p.phase) * 5, p.r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function simulateShot(coin, angle, power, frictionScale = 1) {
    const speed0 = launchSpeedForPower(coin, power);
    const drag = PHYS.drag * frictionScale;
    const rolling = PHYS.rolling * frictionScale;
    let x = coin.x + Math.cos(angle) * coin.radius;
    let y = coin.y + Math.sin(angle) * coin.radius;
    let vx = Math.cos(angle) * speed0;
    let vy = Math.sin(angle) * speed0;
    const points = [];
    const step = 1 / 60;
    for (let i = 0; i < 150; i += 1) {
      const speed = Math.hypot(vx, vy);
      if (speed < 4) break;
      const nextSpeed = Math.max(0, speed * Math.exp(-drag * step) - rolling * step);
      vx *= nextSpeed / speed;
      vy *= nextSpeed / speed;
      x += vx * step;
      y += vy * step;
      if (i % 4 === 0) points.push({ x, y, out: !isInsideArena(x, y) });
      if (nextSpeed < 6) break;
    }
    return points;
  }

  function drawEchoMarkers() {
    G.coins.forEach((coin) => {
      if (!coin.marker || coin.def.id !== 'echo') return;
      const marker = coin.marker;
      const pulse = 0.5 + Math.sin(G.time * 4.2 + (coin.visualSeed % 6283) / 1000) * 0.5;
      const separated = Math.hypot(coin.x - marker.x, coin.y - marker.y) > coin.radius + 16;
      ctx.save();
      ctx.translate(marker.x, marker.y);
      ctx.globalAlpha = 0.82;
      ctx.strokeStyle = rgba(coin.def.color, 0.55 + pulse * 0.25);
      ctx.lineWidth = 1.4;
      ctx.setLineDash([5, 6]);
      ctx.lineDashOffset = -G.time * 24;
      ctx.beginPath();
      ctx.arc(0, 0, coin.radius + 8 + pulse * 3, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = rgba(coin.def.faceLight, 0.6);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-7, 0);
      ctx.lineTo(7, 0);
      ctx.moveTo(0, -7);
      ctx.lineTo(0, 7);
      ctx.stroke();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = rgba(coin.def.color, 0.9);
      ctx.beginPath();
      ctx.arc(0, 0, 2.2, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.5;
      ctx.font = '600 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = rgba(coin.def.faceLight, 0.85);
      if (separated) ctx.fillText('折返点', 0, coin.radius + 25);
      ctx.restore();
      if (coin.alive && coin.hasFired) {
        ctx.save();
        ctx.globalAlpha = 0.16 + pulse * 0.1;
        ctx.strokeStyle = rgba(coin.def.color, 0.8);
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 9]);
        ctx.beginPath();
        ctx.moveTo(marker.x, marker.y);
        ctx.lineTo(coin.x, coin.y);
        ctx.stroke();
        ctx.restore();
      }
    });
  }

  function drawAimPreview() {
    if (G.phase === 'menu' || G.phase === 'over' || G.phase === 'pending') return;
    const coin = G.active;
    if (!coin || !coin.alive || !coin.active) return;
    const isPlayer = G.phase === 'playerAim'
      || (G.phase === 'volleyAim' && coin.id === G.playerId && !G.playerOut);
    const isAI = G.phase === 'aiAim';
    if (!isPlayer && !isAI) return;

    const power = G.aim.power;
    const color = coin.color;
    const dirX = Math.cos(G.aim.angle);
    const dirY = Math.sin(G.aim.angle);
    const shotPower = Math.max(0.06, power);
    const shotSpeed = launchSpeedForPower(coin, shotPower);
    const frictionScale = shotFrictionScale(coin, shotPower);
    const shotTravel = travelDistance(shotSpeed, frictionScale);
    const rimHit = getAimRimHit(coin, G.aim.angle);
    const wallHit = rimHit && rimHit.isWall && shotTravel > rimHit.t ? rimHit : null;
    let points = simulateShot(coin, G.aim.angle, shotPower, frictionScale);
    if (wallHit) {
      points = points.filter((p) => (
        (p.x - coin.x) * dirX + (p.y - coin.y) * dirY
      ) <= wallHit.t - 1);
      points.push({ x: wallHit.x, y: wallHit.y, out: false, wall: true });
    }
    const z = G.camera.zoom;
    const showFull = isAI || G.aim.charging;

    ctx.save();
    // Faint direction ray helps aim before charging; stop it at a wall.
    const startX = coin.x + dirX * (coin.radius + 12);
    const startY = coin.y + dirY * (coin.radius + 12);
    const maxReach = Math.max(G.width, G.height) / z;
    const reach = wallHit ? Math.max(80, wallHit.t + 24) : maxReach;
    ctx.setLineDash([2 / z, 12 / z]);
    ctx.strokeStyle = rgba(color, 0.16);
    ctx.lineWidth = 1 / z;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(startX + dirX * reach, startY + dirY * reach);
    ctx.stroke();
    ctx.setLineDash([]);

    // Dotted travel path.
    points.forEach((p, i) => {
      const t = i / Math.max(1, points.length - 1);
      if (i % 2 === 0) {
        const out = p.out;
        ctx.fillStyle = out
          ? `rgba(255, 95, 112, ${0.32 + t * 0.42})`
          : rgba(color, 0.22 + (1 - t) * 0.44);
        ctx.beginPath();
        ctx.arc(p.x, p.y, (out ? 2.1 : 1.55) / z + (showFull ? power * 0.4 : 0), 0, TAU);
        ctx.fill();
      }
    });

    if (points.length) {
      const end = points[points.length - 1];
      ctx.strokeStyle = end.wall
        ? 'rgba(255,209,102,0.8)'
        : (end.out ? 'rgba(255,95,112,0.55)' : rgba(color, 0.42));
      ctx.lineWidth = 1.2 / z;
      ctx.beginPath();
      ctx.arc(end.x, end.y, 8 / z, 0, TAU);
      ctx.stroke();
    }

    // Wall impact marker instead of the out-of-bounds warning.
    if (wallHit) {
      const pulse = 0.55 + 0.45 * Math.sin(G.time * 6);
      ctx.strokeStyle = `rgba(255,209,102,${0.5 + pulse * 0.3})`;
      ctx.lineWidth = 2.2 / z;
      ctx.setLineDash([3 / z, 4 / z]);
      ctx.beginPath();
      ctx.arc(wallHit.x, wallHit.y, 12 / z, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      const labelX = wallHit.x - dirX * 37;
      const labelY = wallHit.y - dirY * 37;
      ctx.font = `600 ${10 / z}px "Segoe UI", "Microsoft YaHei UI", sans-serif`;
      const tw = ctx.measureText('墙壁反弹').width;
      ctx.fillStyle = 'rgba(18, 12, 4, 0.82)';
      roundRectPath(ctx, labelX - tw / 2 - 7 / z, labelY - 12 / z, tw + 14 / z, 17 / z, 4 / z);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,209,102,0.42)';
      ctx.lineWidth = 0.8 / z;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,220,141,0.96)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('墙壁反弹', labelX, labelY - 3.2 / z);
    }

    // Explicit rim-crossing warning. A wall impact is not a ring-out.
    const rimDistance = rimHit ? rimHit.t : Infinity;
    if (!wallHit && Number.isFinite(rimDistance) && shotTravel > rimDistance) {
      const rimX = coin.x + dirX * rimDistance;
      const rimY = coin.y + dirY * rimDistance;
      const pulse = 0.55 + 0.45 * Math.sin(G.time * 6);
      ctx.strokeStyle = `rgba(255,95,112,${0.5 + pulse * 0.3})`;
      ctx.lineWidth = 2.2 / z;
      ctx.setLineDash([3 / z, 4 / z]);
      ctx.beginPath();
      ctx.arc(rimX, rimY, 12 / z, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      const labelX = rimX - dirX * 37;
      const labelY = rimY - dirY * 37;
      ctx.font = `600 ${10 / z}px "Segoe UI", "Microsoft YaHei UI", sans-serif`;
      const tw = ctx.measureText('越过边界').width;
      ctx.fillStyle = 'rgba(12, 4, 6, 0.78)';
      roundRectPath(ctx, labelX - tw / 2 - 7 / z, labelY - 12 / z, tw + 14 / z, 17 / z, 4 / z);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,95,112,0.35)';
      ctx.lineWidth = 0.8 / z;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,128,141,0.96)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('越过边界', labelX, labelY - 3.2 / z);
    }

    // Direction arrow near the coin.
    const arrowDist = coin.radius + 48 + power * 12;
    const ax = coin.x + dirX * arrowDist;
    const ay = coin.y + dirY * arrowDist;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(G.aim.angle);
    ctx.fillStyle = rgba(color, isPlayer ? 0.82 : 0.58);
    ctx.beginPath();
    ctx.moveTo(7 / z, 0);
    ctx.lineTo(-4 / z, 5 / z);
    ctx.lineTo(-4 / z, -5 / z);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Arc charge gauge around the coin.
    const r = coin.radius + 13 + Math.sin(G.time * 3) * (G.aim.charging ? 1.2 : 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(coin.x, coin.y, r, -Math.PI / 2, Math.PI * 1.5);
    ctx.stroke();
    ctx.strokeStyle = G.aim.power > 0.84 ? '#ff8a76' : color;
    ctx.shadowColor = color;
    ctx.shadowBlur = G.aim.charging ? 15 : 6;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.arc(coin.x, coin.y, r, -Math.PI / 2, -Math.PI / 2 + Math.max(0.045, power) * TAU);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Small power ticks around the active coin.
    for (let i = 0; i <= 10; i += 1) {
      const a = -Math.PI / 2 + i / 10 * TAU;
      const tr = r + 7;
      ctx.strokeStyle = i / 10 <= power ? rgba(color, 0.5) : 'rgba(255,255,255,0.10)';
      ctx.lineWidth = i % 5 === 0 ? 1.5 : 0.8;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * tr, Math.sin(a) * tr);
      ctx.lineTo(Math.cos(a) * (tr + 3), Math.sin(a) * (tr + 3));
      ctx.stroke();
    }

    // AI target marker.
    if (isAI && G.ai.plan && G.ai.plan.target && G.ai.plan.target.alive) {
      drawTargetReticle(G.ai.plan.target, color);
    }

    // Subtle aim readout next to the cursor for the player.
    if (isPlayer) {
      const degrees = Math.round(((G.aim.angle * 180 / Math.PI) % 360 + 360) % 360);
      const s = worldToScreen(coin.x, coin.y);
      ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
      ctx.font = '500 9px "Cascadia Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(226, 248, 242, 0.48)';
      ctx.fillText(`${String(degrees).padStart(3, '0')}° · ${Math.round(power * 100)}%`, s.x, s.y + (coin.radius + 42) * G.camera.zoom);
    }

    ctx.restore();
  }

  function drawTargetReticle(target, color) {
    const t = G.time;
    const r = target.radius + 11 + Math.sin(t * 4) * 2;
    ctx.save();
    ctx.translate(target.x, target.y);
    ctx.strokeStyle = rgba(color, 0.72);
    ctx.lineWidth = 1.4 / G.camera.zoom;
    ctx.shadowColor = color;
    ctx.shadowBlur = 9;
    for (let i = 0; i < 4; i += 1) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      ctx.beginPath();
      ctx.arc(0, 0, r, a - 0.16, a + 0.16);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.strokeStyle = rgba(color, 0.32);
    ctx.lineWidth = 0.8 / G.camera.zoom;
    ctx.beginPath();
    ctx.arc(0, 0, r + 5, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  function drawCurveTrails() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const coin of G.coins) {
      if (!coin.alive || coin.def.id !== 'curve') continue;
      const trail = coin.curveTrail || [];
      if (trail.length < 2) continue;
      for (let pass = 0; pass < 2; pass += 1) {
        for (let i = 1; i < trail.length; i += 1) {
          const prev = trail[i - 1];
          const point = trail[i];
          const t = i / Math.max(1, trail.length - 1);
          const life = clamp(point.life / (point.max || 0.46), 0, 1);
          const width = coin.radius * (0.12 + t * 0.78) * (pass === 0 ? 1.7 : 0.55);
          ctx.strokeStyle = pass === 0
            ? `rgba(166,255,94,${0.05 * life * t})`
            : `rgba(232,255,198,${0.34 * life * t})`;
          ctx.lineWidth = width;
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(point.x, point.y);
          ctx.stroke();
        }
      }
      for (let i = 0; i < trail.length; i += 1) {
        const point = trail[i];
        const life = clamp(point.life / (point.max || 0.46), 0, 1);
        const t = i / Math.max(1, trail.length - 1);
        ctx.fillStyle = `rgba(220,255,174,${0.14 * life * t})`;
        ctx.beginPath();
        ctx.arc(
          point.x - Math.cos(point.angle) * coin.radius * 0.35,
          point.y - Math.sin(point.angle) * coin.radius * 0.35,
          coin.radius * 0.12 * (0.4 + t) * life,
          0,
          TAU,
        );
        ctx.fill();
      }
      const head = trail[trail.length - 1];
      const headLife = clamp(head.life / (head.max || 0.46), 0, 1);
      const headX = coin.x - coin.vx * 0.012;
      const headY = coin.y - coin.vy * 0.012;
      const glow = ctx.createRadialGradient(headX, headY, 0, headX, headY, coin.radius * 1.6);
      glow.addColorStop(0, `rgba(200,255,150,${0.2 * headLife})`);
      glow.addColorStop(1, 'rgba(166,255,94,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(headX, headY, coin.radius * 1.6, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawCoinTrails() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const coin of G.coins) {
      if (!coin.alive) continue;
      const n = coin.trail.length;
      for (let i = 0; i < n; i += 1) {
        const p = coin.trail[i];
        const life = clamp(p.life / 0.24, 0, 1);
        const t = i / Math.max(1, n);
        const radius = coin.radius * (0.2 + t * 0.58);
        ctx.fillStyle = rgba(coin.color, life * 0.055 * (0.4 + t));
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawCoins() {
    const aliveCoins = G.coins.filter((c) => c.alive);
    aliveCoins.sort((a, b) => a.y - b.y);
    aliveCoins.forEach(drawCoin);
    G.coins.filter((c) => !c.alive && c.fall < 1).forEach(drawCoin);
  }

  function drawCoin(coin) {
    const isOut = !coin.alive;
    const falling = isOut ? coin.fall : 0;
    const scale = coin.spawn * (1 - falling * 0.52);
    if (scale <= 0.01) return;

    const bobPhase = (coin.visualSeed % 6283) / 1000;
    const bob = G.phase === 'menu' ? Math.sin(G.menuTime * 0.7 + bobPhase) * 1.4 : 0;
    const x = coin.x;
    const y = coin.y + bob + falling * 54;
    const r = coin.radius;
    const z = G.camera.zoom;
    const alpha = isOut ? 1 - falling * 0.9 : 1;
    const isActive = coin.active && G.active === coin
      && (G.phase === 'playerAim' || G.phase === 'aiAim'
        || (G.phase === 'volleyAim' && coin.id === G.playerId && !coin.locked))
      && !isOut;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Ground shadow.
    ctx.save();
    ctx.translate(x + 4, y + 9 + falling * 24);
    ctx.scale(1, 0.82 + falling * 0.2);
    const shadow = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 1.15);
    shadow.addColorStop(0, 'rgba(0,0,0,0.62)');
    shadow.addColorStop(0.7, 'rgba(0,0,0,0.3)');
    shadow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.15, 0, TAU);
    ctx.fill();
    ctx.restore();

    // Danger halo.
    if (!isOut && coin.danger > 0.25) {
      const pulse = 0.5 + 0.5 * Math.sin(G.time * 6.5);
      const g = ctx.createRadialGradient(x, y, r * 0.7, x, y, r * 2.2);
      g.addColorStop(0, `rgba(255,95,112,${0.04 + coin.danger * 0.08})`);
      g.addColorStop(1, 'rgba(255,95,112,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * 2.2, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,95,112,${0.22 + coin.danger * 0.4 * pulse})`;
      ctx.lineWidth = 1.4;
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.arc(x, y, r + 9 + pulse * 2, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Active halo.
    if (isActive) {
      const pulse = 0.5 + 0.5 * Math.sin(G.time * 2.4);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(G.time * 0.6);
      ctx.strokeStyle = rgba(coin.color, 0.42 + pulse * 0.22);
      ctx.lineWidth = 1.1;
      ctx.setLineDash([4, 9]);
      ctx.beginPath();
      ctx.arc(0, 0, r + 18 + pulse * 2, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      const g = ctx.createRadialGradient(x, y, r, x, y, r * 2.5);
      g.addColorStop(0, rgba(coin.color, 0.11));
      g.addColorStop(1, rgba(coin.color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * 2.5, 0, TAU);
      ctx.fill();
    }

    // First-shot protection: an anchored shield ring until the coin first fires.
    if (isFirstShotProtected(coin)) {
      const pulse = 0.5 + 0.5 * Math.sin(G.time * 2.2 + (coin.visualSeed % 6283) / 1000);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-G.time * 0.45);
      ctx.strokeStyle = `rgba(255, 224, 158, ${0.34 + pulse * 0.2})`;
      ctx.lineWidth = 1.35;
      ctx.setLineDash([5, 7]);
      ctx.beginPath();
      ctx.arc(0, 0, r + 23 + pulse * 1.5, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.rotate(G.time * 0.9);
      ctx.strokeStyle = 'rgba(80, 231, 212, 0.24)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 11]);
      ctx.beginPath();
      ctx.arc(0, 0, r + 28, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Selected coin halo on the menu preview.
    if (G.phase === 'menu' && coin.id === G.playerId) {
      const pulse = 0.5 + 0.5 * Math.sin(G.menuTime * 2.1);
      ctx.strokeStyle = rgba(coin.color, 0.26 + pulse * 0.28);
      ctx.lineWidth = 1.1;
      ctx.setLineDash([3, 7]);
      ctx.beginPath();
      ctx.arc(x, y, r + 15 + pulse * 2, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.rotate(coin.rot);

    const squash = 1 + Math.sin(Math.min(1, coin.squash) * Math.PI) * 0.055;
    ctx.scale(squash, 1 / squash);

    // Coin thickness.
    ctx.fillStyle = '#17130b';
    ctx.beginPath();
    ctx.arc(0, 3.5, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = shade(coin.def.faceDark, -0.36);
    ctx.beginPath();
    ctx.arc(0, 2.6, r, 0, TAU);
    ctx.fill();

    // Outer rim.
    const rim = ctx.createConicGradient(-0.4 + coin.rot * 0.2, 0, 0);
    rim.addColorStop(0, shade(coin.color, 0.18));
    rim.addColorStop(0.11, shade(coin.def.faceDark, 0.1));
    rim.addColorStop(0.27, coin.color);
    rim.addColorStop(0.48, shade(coin.color, -0.3));
    rim.addColorStop(0.63, shade(coin.color, 0.2));
    rim.addColorStop(0.8, shade(coin.def.faceDark, 0.2));
    rim.addColorStop(1, shade(coin.color, 0.18));
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();

    // Knurled edge.
    for (let i = 0; i < 44; i += 1) {
      const a = i / 44 * TAU;
      ctx.strokeStyle = i % 2 === 0 ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (r - 1.7), Math.sin(a) * (r - 1.7));
      ctx.lineTo(Math.cos(a) * (r - 0.4), Math.sin(a) * (r - 0.4));
      ctx.stroke();
    }

    // Inner face.
    const rr = r - 4.2;
    const face = ctx.createRadialGradient(-rr * 0.34, -rr * 0.4, rr * 0.1, 0, 0, rr * 1.12);
    face.addColorStop(0, coin.def.faceLight);
    face.addColorStop(0.28, shade(coin.def.faceMid, 0.2));
    face.addColorStop(0.72, coin.def.faceMid);
    face.addColorStop(1, coin.def.faceDark);
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.arc(0, 0, rr, 0, TAU);
    ctx.fill();

    // Engraved ring.
    ctx.strokeStyle = 'rgba(0,0,0,0.23)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, rr * 0.79, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.arc(0, 0, rr * 0.75, 0, TAU);
    ctx.stroke();

    // Emblem.
    drawEmblem(ctx, coin.def.emblem, rr * 0.47, coin.def.faceDark);

    // Rim inner highlight.
    const bezel = ctx.createLinearGradient(-rr, -rr, rr, rr);
    bezel.addColorStop(0, 'rgba(255,255,255,0.48)');
    bezel.addColorStop(0.28, 'rgba(255,255,255,0.02)');
    bezel.addColorStop(0.62, 'rgba(0,0,0,0.12)');
    bezel.addColorStop(1, 'rgba(255,255,255,0.26)');
    ctx.strokeStyle = bezel;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, rr - 0.8, 0, TAU);
    ctx.stroke();

    // Specular sweep.
    ctx.save();
    ctx.rotate(-0.7);
    const spec = ctx.createLinearGradient(-r, 0, r, 0);
    spec.addColorStop(0, 'rgba(255,255,255,0)');
    spec.addColorStop(0.44, 'rgba(255,255,255,0.26)');
    spec.addColorStop(0.55, 'rgba(255,255,255,0.02)');
    spec.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = spec;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, r - 8, Math.PI * 0.18, Math.PI * 0.73);
    ctx.stroke();
    ctx.restore();

    // Flash on impact.
    if (coin.flash > 0.01) {
      ctx.fillStyle = `rgba(255,250,225,${clamp(coin.flash, 0, 0.9) * 0.4})`;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawEmblem(g, type, size, color) {
    g.save();
    g.strokeStyle = rgba(color, 0.82);
    g.fillStyle = rgba(color, 0.65);
    g.lineWidth = Math.max(1.2, size * 0.075);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    if (type === 'sun') {
      g.beginPath();
      g.arc(0, 0, size * 0.3, 0, TAU);
      g.stroke();
      for (let i = 0; i < 8; i += 1) {
        const a = i / 8 * TAU;
        g.beginPath();
        g.moveTo(Math.cos(a) * size * 0.5, Math.sin(a) * size * 0.5);
        g.lineTo(Math.cos(a) * size * 0.92, Math.sin(a) * size * 0.92);
        g.stroke();
      }
      g.beginPath();
      g.arc(0, 0, size * 0.12, 0, TAU);
      g.fill();
    } else if (type === 'star') {
      const pts = [];
      for (let i = 0; i < 8; i += 1) {
        const a = -Math.PI / 2 + i * Math.PI / 4;
        const rad = i % 2 === 0 ? size * 0.95 : size * 0.34;
        pts.push([Math.cos(a) * rad, Math.sin(a) * rad]);
      }
      g.beginPath();
      pts.forEach(([x, y], i) => {
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.closePath();
      g.stroke();
      g.beginPath();
      g.arc(0, 0, size * 0.13, 0, TAU);
      g.fill();
    } else if (type === 'wave') {
      for (let k = -1; k <= 1; k += 1) {
        g.beginPath();
        g.moveTo(-size * 0.92, k * size * 0.33);
        g.bezierCurveTo(-size * 0.38, k * size * 0.33 - size * 0.44, size * 0.38, k * size * 0.33 + size * 0.44, size * 0.92, k * size * 0.33);
        g.stroke();
      }
    } else if (type === 'bolt') {
      g.beginPath();
      g.moveTo(size * 0.2, -size);
      g.lineTo(-size * 0.62, size * 0.08);
      g.lineTo(-size * 0.04, size * 0.08);
      g.lineTo(-size * 0.24, size);
      g.lineTo(size * 0.65, -size * 0.18);
      g.lineTo(size * 0.07, -size * 0.18);
      g.closePath();
      g.stroke();
      g.fillStyle = rgba(color, 0.16);
      g.fill();
    } else if (type === 'bloom') {
      for (let i = 0; i < 5; i += 1) {
        const a = -Math.PI / 2 + (i / 5) * TAU;
        const px = Math.cos(a) * size * 0.48;
        const py = Math.sin(a) * size * 0.48;
        g.beginPath();
        g.ellipse(px, py, size * 0.34, size * 0.2, a + Math.PI / 2, 0, TAU);
        g.stroke();
      }
      g.beginPath();
      g.arc(0, 0, size * 0.15, 0, TAU);
      g.fill();
    } else if (type === 'leaf') {
      g.beginPath();
      g.moveTo(0, size * 0.92);
      g.bezierCurveTo(-size * 0.9, size * 0.24, -size * 0.5, -size * 0.82, 0, -size * 0.92);
      g.bezierCurveTo(size * 0.5, -size * 0.82, size * 0.9, size * 0.24, 0, size * 0.92);
      g.stroke();
      g.beginPath();
      g.moveTo(0, size * 0.72);
      g.lineTo(0, -size * 0.55);
      g.moveTo(0, 0);
      g.lineTo(size * 0.38, -size * 0.36);
      g.moveTo(0, size * 0.3);
      g.lineTo(-size * 0.36, -size * 0.04);
      g.stroke();
    } else if (type === 'target') {
      g.beginPath();
      g.arc(0, 0, size * 0.72, 0, TAU);
      g.stroke();
      g.beginPath();
      g.arc(0, 0, size * 0.38, 0, TAU);
      g.stroke();
      g.beginPath();
      g.arc(0, 0, size * 0.1, 0, TAU);
      g.fill();
      g.beginPath();
      g.moveTo(-size * 0.98, 0);
      g.lineTo(-size * 0.62, 0);
      g.moveTo(size * 0.62, 0);
      g.lineTo(size * 0.98, 0);
      g.moveTo(0, -size * 0.98);
      g.lineTo(0, -size * 0.62);
      g.moveTo(0, size * 0.62);
      g.lineTo(0, size * 0.98);
      g.stroke();
    } else if (type === 'echo') {
      g.beginPath();
      g.arc(0, 0, size * 0.68, 0, TAU);
      g.stroke();
      g.beginPath();
      g.arc(0, 0, size * 0.38, 0, TAU);
      g.stroke();
      g.beginPath();
      g.arc(0, 0, size * 0.1, 0, TAU);
      g.fill();
      g.beginPath();
      g.moveTo(-size * 0.86, -size * 0.2);
      g.lineTo(-size * 0.42, -size * 0.2);
      g.lineTo(-size * 0.42, size * 0.24);
      g.stroke();
      g.beginPath();
      g.moveTo(size * 0.32, -size * 0.48);
      g.quadraticCurveTo(size * 0.92, -size * 0.12, size * 0.52, size * 0.52);
      g.stroke();
    } else if (type === 'anchor') {
      g.beginPath();
      g.arc(0, 0, size * 0.72, 0, TAU);
      g.stroke();
      g.beginPath();
      g.moveTo(-size * 0.92, 0);
      g.lineTo(size * 0.92, 0);
      g.moveTo(0, -size * 0.92);
      g.lineTo(0, size * 0.92);
      g.stroke();
      g.beginPath();
      g.arc(0, 0, size * 0.3, 0, TAU);
      g.stroke();
      g.beginPath();
      g.moveTo(-size * 0.42, size * 0.56);
      g.lineTo(0, size * 0.28);
      g.lineTo(size * 0.42, size * 0.56);
      g.stroke();
    } else if (type === 'curve') {
      g.beginPath();
      g.moveTo(-size * 0.86, size * 0.34);
      g.bezierCurveTo(-size * 0.24, size * 0.86, size * 0.34, -size * 0.72, size * 0.86, -size * 0.1);
      g.stroke();
      g.beginPath();
      g.moveTo(size * 0.56, -size * 0.5);
      g.lineTo(size * 0.9, -size * 0.08);
      g.lineTo(size * 0.42, size * 0.02);
      g.stroke();
      g.beginPath();
      g.arc(0, 0, size * 0.9, -Math.PI * 0.2, Math.PI * 0.2);
      g.stroke();
    } else if (type === 'flame') {
      g.beginPath();
      g.moveTo(0, size * 0.9);
      g.bezierCurveTo(-size * 0.78, size * 0.42, -size * 0.42, -size * 0.2, -size * 0.08, -size * 0.9);
      g.bezierCurveTo(size * 0.14, -size * 0.48, size * 0.34, -size * 0.36, size * 0.42, -size * 0.02);
      g.bezierCurveTo(size * 0.82, size * 0.3, size * 0.5, size * 0.74, 0, size * 0.9);
      g.closePath();
      g.stroke();
      g.fillStyle = rgba(color, 0.14);
      g.fill();
      g.beginPath();
      g.moveTo(0, size * 0.62);
      g.bezierCurveTo(-size * 0.24, size * 0.28, size * 0.02, size * 0.12, size * 0.12, -size * 0.16);
      g.bezierCurveTo(size * 0.36, size * 0.14, size * 0.2, size * 0.46, 0, size * 0.62);
      g.stroke();
    }
    g.restore();
  }

  function drawWaves(above) {
    ctx.save();
    ctx.globalCompositeOperation = above ? 'source-over' : 'lighter';
    for (const w of G.effects.waves) {
      const t = 1 - w.life / w.maxLife;
      const alpha = (1 - t) * (w.fill ? 0.42 : (above ? 0.38 : 0.56));
      if (alpha <= 0) continue;
      ctx.strokeStyle = w.color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = w.lineWidth * (1 - t * 0.5);
      if (w.fill) {
        ctx.fillStyle = w.color;
        ctx.beginPath();
        ctx.arc(w.x, w.y, w.radius, 0, TAU);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(w.x, w.y, w.radius, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawParticles() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of G.effects.sparks) {
      const alpha = clamp(p.life / p.maxLife, 0, 1);
      if (alpha <= 0) continue;
      const len = clamp(Math.hypot(p.vx, p.vy) * 0.022, 0.5, 15);
      const angle = Math.atan2(p.vy, p.vx);
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = p.size;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - Math.cos(angle) * len, p.y - Math.sin(angle) * len);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const p of G.effects.puffs) {
      const alpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = alpha * 0.75;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 + (1 - alpha) * 1.5), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawFloatingTexts() {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of G.effects.texts) {
      const s = worldToScreen(t.x, t.y);
      const alpha = clamp(t.life / t.maxLife, 0, 1);
      ctx.globalAlpha = Math.min(1, alpha * 1.8);
      ctx.font = `700 ${t.size}px "Bahnschrift", "Segoe UI", "Microsoft YaHei UI", sans-serif`;
      ctx.fillStyle = t.color;
      ctx.shadowColor = t.color;
      ctx.shadowBlur = 10;
      ctx.fillText(t.text, s.x, s.y);
    }
    ctx.restore();
  }

  function drawCoinLabels() {
    if (G.phase === 'menu' || G.phase === 'over' || G.resultOpen) return;
    const active = G.active;
    if (!active || !active.alive || (G.phase !== 'playerAim' && G.phase !== 'aiAim' && G.phase !== 'volleyAim')) return;
    const s = worldToScreen(active.x, active.y);
    const z = G.camera.zoom;
    const y = s.y - active.radius * z - 33;
    const isPlayer = active.id === G.playerId;
    const label = isPlayer ? `${active.name} · 你的硬币` : `${active.name} · 对手`;
    ctx.save();
    ctx.font = '600 10px "Segoe UI", "Microsoft YaHei UI", sans-serif';
    const width = ctx.measureText(label).width + 22;
    roundRectPath(ctx, s.x - width / 2, y - 11, width, 22, 11);
    ctx.fillStyle = 'rgba(4, 11, 13, 0.78)';
    ctx.fill();
    ctx.strokeStyle = rgba(active.color, 0.30);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = active.color;
    ctx.beginPath();
    ctx.arc(s.x - width / 2 + 9, y, 2.2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(228, 245, 240, 0.88)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, s.x - width / 2 + 15, y + 0.5);
    ctx.restore();
  }

  function drawOffscreenIndicator() {
    if (G.phase === 'menu' || G.phase === 'over' || !G.active || !G.active.alive) return;
    const s = worldToScreen(G.active.x, G.active.y);
    const margin = 46;
    if (s.x > margin && s.x < G.width - margin && s.y > margin && s.y < G.height - margin) return;
    const cx = G.width / 2;
    const cy = G.height / 2;
    const dx = s.x - cx;
    const dy = s.y - cy;
    const angle = Math.atan2(dy, dx);
    const rx = G.width / 2 - margin;
    const ry = G.height / 2 - margin;
    const t = Math.min(Math.abs(rx / (Math.cos(angle) || 0.0001)), Math.abs(ry / (Math.sin(angle) || 0.0001)));
    const x = cx + Math.cos(angle) * t;
    const y = cy + Math.sin(angle) * t;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = rgba(G.active.color, 0.86);
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(-5, 6);
    ctx.lineTo(-1, 0);
    ctx.lineTo(-5, -6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.font = '600 9px "Segoe UI", "Microsoft YaHei UI", sans-serif';
    ctx.fillStyle = rgba(G.active.color, 0.86);
    ctx.textAlign = 'center';
    const label = G.active.id === G.playerId ? '你的硬币' : G.active.name;
    ctx.fillText(label, x, y + 22);
    ctx.restore();
  }

  function drawScreenFlash() {
    if (G.flash.alpha > 0) {
      ctx.fillStyle = `rgba(${G.flash.color},${G.flash.alpha})`;
      ctx.fillRect(0, 0, G.width, G.height);
    }
    if (G.slowmo > 0) {
      const alpha = clamp(G.slowmo / 0.62, 0, 1) * 0.13;
      const g = ctx.createRadialGradient(G.width / 2, G.height / 2, G.height * 0.2, G.width / 2, G.height / 2, Math.max(G.width, G.height) * 0.72);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(80, 12, 20, ${alpha})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, G.width, G.height);
    }
  }

  function drawCursor() {
    if (G.phase === 'menu' || G.helpOpen || G.resultOpen || !G.pointer.inside) return;
    const x = G.pointer.x;
    const y = G.pointer.y;
    const isPlayer = G.phase === 'playerAim'
      || (G.phase === 'volleyAim' && G.active && G.active.id === G.playerId && !G.playerOut && !G.volley?.playerLocked);
    const active = G.active;
    const color = isPlayer && active ? active.color : '#8fa7a2';
    const idleAlpha = isPlayer ? 0.64 : 0.36;
    const charging = G.aim.charging;
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = rgba(color, charging ? 0.95 : idleAlpha);
    ctx.fillStyle = rgba(color, isPlayer ? 0.9 : 0.55);
    ctx.lineWidth = 1.2;
    const r = charging ? 11 - G.aim.power * 2 : 9;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 1.8, 0, TAU);
    ctx.fill();
    for (let i = 0; i < 4; i += 1) {
      const a = i * Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (r + 3), Math.sin(a) * (r + 3));
      ctx.lineTo(Math.cos(a) * (r + 8), Math.sin(a) * (r + 8));
      ctx.stroke();
    }
    if (charging) {
      ctx.strokeStyle = rgba(color, 0.9);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 17, -Math.PI / 2, -Math.PI / 2 + Math.max(0.02, G.aim.power) * TAU);
      ctx.stroke();
      ctx.font = '500 9px "Cascadia Mono", monospace';
      ctx.fillStyle = 'rgba(235, 250, 246, 0.78)';
      ctx.textAlign = 'left';
      ctx.fillText(`${Math.round(G.aim.power * 100)}%`, 22, 3);
    }
    ctx.restore();
  }

  /* =========================================================
     Input
     ========================================================= */
  function setPointerFromEvent(e) {
    const rect = dom.canvas.getBoundingClientRect();
    G.pointer.x = e.clientX - rect.left;
    G.pointer.y = e.clientY - rect.top;
    const world = screenToWorld(G.pointer.x, G.pointer.y);
    G.pointer.worldX = world.x;
    G.pointer.worldY = world.y;
    G.pointer.inside = G.pointer.x >= 0 && G.pointer.x <= G.width && G.pointer.y >= 0 && G.pointer.y <= G.height;
  }

  dom.canvas.addEventListener('pointerdown', (e) => {
    setPointerFromEvent(e);
    if (G.chase) {
      if (e.button === 2) {
        cancelChaseCharge();
        return;
      }
      if (e.button !== 0) return;
      if (!canChaseAim() || G.paused || G.helpOpen || G.resultOpen) return;
      e.preventDefault();
      try {
        dom.canvas.setPointerCapture(e.pointerId);
      } catch (err) {
        /* pointer capture is optional */
      }
      G.pointer.down = true;
      startChaseCharge();
      return;
    }
    if (e.button === 2) {
      cancelCharge();
      return;
    }
    if (e.button !== 0) return;
    if (!canPlayerAim() || G.paused || G.helpOpen || G.resultOpen) return;
    e.preventDefault();
    try {
      dom.canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      /* pointer capture is optional */
    }
    startCharge();
  });

  dom.canvas.addEventListener('pointermove', (e) => {
    setPointerFromEvent(e);
    if (G.chase) return;
    if (canPlayerAim() && !G.paused) updateAimFromPointer();
  });

  dom.canvas.addEventListener('pointerenter', (e) => {
    setPointerFromEvent(e);
    G.pointer.inside = true;
  });

  dom.canvas.addEventListener('pointerleave', () => {
    if (!G.pointer.down) G.pointer.inside = false;
  });

  dom.canvas.addEventListener('pointerup', (e) => {
    if (e.button !== 0) return;
    setPointerFromEvent(e);
    if (G.chase) {
      releaseChaseShot();
      return;
    }
    releaseCharge();
  });

  dom.canvas.addEventListener('pointercancel', () => {
    if (G.chase) {
      cancelChaseCharge();
      return;
    }
    cancelCharge();
    G.pointer.down = false;
  });

  window.addEventListener('pointerup', (e) => {
    if (e.button !== 0) return;
    // Canvas pointerup handles the common case; this catches releases outside.
    if (G.chase) {
      if (G.aim.charging) releaseChaseShot();
      return;
    }
    if (G.aim.charging) releaseCharge();
    G.pointer.down = false;
  });

  dom.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  dom.canvas.addEventListener('wheel', (e) => {
    if (G.chase) {
      e.preventDefault();
      return;
    }
    if (G.helpOpen || G.resultOpen) return;
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.00125);
    zoomAt(e.clientX, e.clientY, factor);
  }, { passive: false });

  window.addEventListener('resize', resize);
  window.addEventListener('blur', () => {
    clearPanKeys();
    clearCurveInput();
    if (G.chase) cancelChaseCharge();
    if (G.aim.charging) cancelCharge();
  });

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (G.personalityPoolOpen) {
      if (e.key === 'Escape') closePersonalityPool();
      return;
    }
    const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
    if (G.onlineLobbyOpen) {
      if (e.key === 'Escape') {
        if (dom.onlineCoinPicker && !dom.onlineCoinPicker.hidden) closeOnlineCoinPicker();
        else closeOnlineLobby();
      }
      return;
    }
    if (typing) return;
    if (G.quitOpen) {
      if (e.key === 'Escape') closeQuitConfirm();
      return;
    }
    if (G.aiPersonaOpen) {
      if (e.key === 'Escape') closeAIPersona();
      return;
    }
    if (G.inspectOpen) {
      if (e.key === 'Escape' || e.key === 'c' || e.key === 'C') closeInspect();
      return;
    }
    if (G.codexOpen) {
      if (e.key === 'Escape') closeCodex();
      return;
    }
    if (G.arenaOpen) {
      if (e.key === 'Escape') closeArena();
      return;
    }
    if (G.chase && G.phase === 'chase') {
      if (CHASE_KEY_MAP[e.key]) {
        e.preventDefault();
        return;
      }
      if (e.key === 'c' || e.key === 'C' || e.key === 'e' || e.key === 'E') return;
    }
    if ((e.key === 'c' || e.key === 'C') && G.phase !== 'menu' && G.phase !== 'over' && !G.helpOpen && !G.resultOpen) {
      openInspect(G.active ? G.active.id : G.playerId);
      return;
    }
    const curveCoin = playerCoin();
    if (curveCoin && curveCoin.def.id === 'curve' && (e.key === 'q' || e.key === 'Q' || e.key === 'e' || e.key === 'E')) {
      const sliding = curveCoin.alive && Math.hypot(curveCoin.vx, curveCoin.vy) > 18;
      if (sliding && G.phase !== 'menu' && G.phase !== 'over' && !G.helpOpen && !G.resultOpen) {
        e.preventDefault();
        setCurveInput(e.key === 'q' || e.key === 'Q' ? 'left' : 'right', true);
        return;
      }
    }
    if (e.key === 'e' || e.key === 'E') {
      const anchorCoin = playerCoin();
      if (anchorCoin && anchorCoin.def.id === 'anchor' && G.phase === 'resolve'
        && useAnchorSkill(anchorCoin)) {
        e.preventDefault();
        return;
      }
      if (G.phase !== 'menu' && G.phase !== 'over' && !G.helpOpen && !G.resultOpen) {
        e.preventDefault();
        useEchoSkill();
      }
      return;
    }
    const panDir = PAN_KEY_MAP[e.key];
    if (panDir) {
      if (G.phase !== 'menu' && G.phase !== 'over' && !G.helpOpen && !G.resultOpen && !G.paused) {
        e.preventDefault();
        G.panKeys[panDir] = true;
        if (!G.aim.charging) G.camera.userPanned = true;
      }
      return;
    }
    if (e.key === 'Escape') {
      if (G.helpOpen) {
        closeHelp();
        return;
      }
      if (G.resultOpen) {
        returnToMenu();
        return;
      }
      if (G.aim.charging) cancelCharge();
      return;
    }
    if (e.key === 'r' || e.key === 'R') {
      if (!G.helpOpen) {
        if (G.phase === 'menu') startGame();
        else startGame();
      }
      return;
    }
    if (e.key === 'm' || e.key === 'M') {
      toggleSound();
      return;
    }
    if (e.key === 'f' || e.key === 'F') {
      toggleFullscreen();
      return;
    }
    if (e.key === 'h' || e.key === 'H') {
      if (G.resultOpen) return;
      if (G.helpOpen) closeHelp();
      else openHelp();
      return;
    }
    if (e.key === '+' || e.key === '=') {
      zoomAt(G.width / 2, G.height / 2, 1.16);
      return;
    }
    if (e.key === '-') {
      zoomAt(G.width / 2, G.height / 2, 0.86);
    }
  });

  window.addEventListener('keyup', (e) => {
    const curveCoin = playerCoin();
    if (curveCoin && curveCoin.def.id === 'curve') {
      if (e.key === 'q' || e.key === 'Q') setCurveInput('left', false);
      if (e.key === 'e' || e.key === 'E') setCurveInput('right', false);
    }
    const chaseDir = CHASE_KEY_MAP[e.key];
    if (G.chase && chaseDir) {
      G.chase.keys[chaseDir] = false;
      return;
    }
    const panDir = PAN_KEY_MAP[e.key];
    if (panDir) {
      G.panKeys[panDir] = false;
    }
  });

  /* =========================================================
     Buttons
     ========================================================= */
  dom.startBtn.addEventListener('click', () => {
    audio.ui();
    startGame();
  });
  dom.menuHelpBtn.addEventListener('click', openHelp);
  dom.onlineBtn.addEventListener('click', openOnlineLobby);
  dom.aiPersonaBtn.addEventListener('click', openAIPersona);
  dom.aiPersonaClose.addEventListener('click', () => closeAIPersona());
  dom.aiPersonaDone.addEventListener('click', () => closeAIPersona());
  dom.aiPersona.querySelector('.modal-backdrop').addEventListener('click', () => closeAIPersona());
  dom.aiPersona.addEventListener('click', (e) => {
    if (e.target === dom.aiPersona) closeAIPersona();
  });
  dom.quitGameBtn.addEventListener('click', openQuitConfirm);
  dom.quitCancel.addEventListener('click', () => closeQuitConfirm());
  dom.quitConfirm.addEventListener('click', confirmQuitGame);
  dom.quit.querySelector('.modal-backdrop').addEventListener('click', () => closeQuitConfirm());
  dom.quit.addEventListener('click', (e) => {
    if (e.target === dom.quit) closeQuitConfirm();
  });
  dom.onlineExitBtn.addEventListener('click', () => {
    if (G.online && G.online.active) onlineLeaveGame();
  });
  dom.onlineClose.addEventListener('click', closeOnlineLobby);
  dom.onlineCreate.addEventListener('click', onlineCreateRoom);
  dom.onlineJoin.addEventListener('click', onlineJoinRoom);
  dom.onlineStart.addEventListener('click', onlineStartMatch);
  dom.onlineLeave.addEventListener('click', closeOnlineLobby);
  dom.onlineFillAI.addEventListener('click', onlineFillAI);
  dom.onlineArenaBtn.addEventListener('click', openOnlineArenaEditor);
  dom.onlinePoolBtn.addEventListener('click', openPersonalityPool);
  dom.onlineModeButtons.forEach((button) => {
    button.addEventListener('click', () => onlineChangeMode(button.dataset.mode));
  });
  dom.onlineCoinPickerClose.addEventListener('click', () => closeOnlineCoinPicker());
  dom.onlineCoinOptions.addEventListener('click', (event) => {
    const button = event.target.closest('[data-online-coin]');
    if (!button || button.disabled || !G.online) return;
    onlineSetCoin(button.dataset.onlineCoin, G.online.pickerIndex);
  });
  dom.onlineSlots.addEventListener('click', (event) => {
    const coin = event.target.closest('[data-online-coin-index]');
    if (coin) {
      openOnlineCoinPicker(Number(coin.dataset.onlineCoinIndex));
      return;
    }
    const add = event.target.closest('[data-online-ai-add]');
    if (add) {
      onlineSetAI('add', Number(add.dataset.onlineAiAdd));
      return;
    }
    const remove = event.target.closest('[data-online-ai-remove]');
    if (remove) onlineSetAI('remove', Number(remove.dataset.onlineAiRemove));
  });
  dom.onlineCopy.addEventListener('click', async () => {
    const code = dom.onlineRoomCode?.textContent?.trim();
    if (!code) return;
    const ok = await copyText(code);
    if (ok) addToast('房间码已复制', 'info', 1400);
    else window.prompt('复制房间码', code);
  });
  dom.onlineShare.addEventListener('click', async () => {
    const url = await onlineInviteUrl();
    if (!url) {
      addToast('邀请链接需要在联机服务器网址下生成', 'info', 2200);
      return;
    }
    const ok = await copyText(url);
    if (ok) addToast('邀请链接已复制，朋友打开会自动加入', 'info', 2200);
    else window.prompt('复制邀请链接', url);
  });
  dom.onlineCode.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onlineJoinRoom();
    }
  });
  dom.onlineName.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onlineCreateRoom();
    }
  });
  dom.online.querySelector('.modal-backdrop').addEventListener('click', closeOnlineLobby);
  dom.online.addEventListener('click', (event) => {
    if (event.target === dom.online) closeOnlineLobby();
  });
  dom.arenaBtn.addEventListener('click', openArena);
  dom.arenaClose.addEventListener('click', () => closeArena());
  dom.arenaDone.addEventListener('click', () => closeArena());
  dom.arenaReset.addEventListener('click', () => {
    audio.init();
    audio.ui();
    G.arena.walls = createDefaultWalls();
    G.arena.turnLimit = ARENA_DEFAULT_TURN_LIMIT;
    G.arena.shrinkRate = ARENA_DEFAULT_SHRINK_RATE;
    G.arena.obstacles = sanitizeObstacleConfig(DEFAULT_OBSTACLE_CONFIG);
    applyArenaConfig('circle', 1, { effects: true });
  });
  dom.wallGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('.wall-btn');
    if (!btn) return;
    toggleWall(Number(btn.dataset.edgeIndex));
  });
  if (dom.obstacleCountRange) {
    dom.obstacleCountRange.addEventListener('input', () => {
      const current = sanitizeObstacleConfig(G.arena.obstacles);
      const count = Number(dom.obstacleCountRange.value);
      G.arena.obstacles = current.placement === 'custom'
        ? syncCustomObstacleCount(current, count)
        : sanitizeObstacleConfig({ ...current, count });
      if (count > 0) G.obstacleLastCount = count;
      saveArenaConfig();
      G.arenaObstaclePreview = null;
      updateObstacleControls();
      drawArenaPreview();
    });
  }
  if (dom.obstacleCustomPlacement) {
    dom.obstacleCustomPlacement.addEventListener('change', () => {
      const current = sanitizeObstacleConfig(G.arena.obstacles);
      const custom = dom.obstacleCustomPlacement.checked;
      if (custom) {
        const target = Math.max(1, current.count || G.obstacleLastCount || 4);
        const items = current.items.slice(0, target);
        while (items.length < target) {
          items.push(createCustomObstacleItem({ ...current, count: target }, items.length));
        }
        G.arena.obstacles = sanitizeObstacleConfig({
          ...current,
          count: target,
          placement: 'custom',
          items,
        });
        G.arenaObstacleSelected = 0;
      } else {
        G.arena.obstacles = sanitizeObstacleConfig({
          ...current,
          count: current.items.length || current.count,
          placement: 'random',
        });
      }
      saveArenaConfig();
      G.arenaObstaclePreview = null;
      updateArenaUI();
      audio.init();
      audio.ui();
    });
  }
  if (dom.obstacleSizeRange) {
    dom.obstacleSizeRange.addEventListener('input', () => {
      const current = sanitizeObstacleConfig(G.arena.obstacles);
      if (current.placement !== 'custom' || !current.items.length) return;
      const index = clamp(G.arenaObstacleSelected, 0, current.items.length - 1);
      const items = current.items.map((item, itemIndex) => itemIndex === index
        ? { ...item, size: Number(dom.obstacleSizeRange.value) }
        : item);
      G.arena.obstacles = sanitizeObstacleConfig({ ...current, items });
      saveArenaConfig();
      G.arenaObstaclePreview = null;
      updateObstacleControls();
      drawArenaPreview();
    });
  }
  if (dom.obstacleRotationRange) {
    dom.obstacleRotationRange.addEventListener('input', () => {
      const current = sanitizeObstacleConfig(G.arena.obstacles);
      if (current.placement !== 'custom' || !current.items.length) return;
      const index = clamp(G.arenaObstacleSelected, 0, current.items.length - 1);
      const rotation = Number(dom.obstacleRotationRange.value) * Math.PI / 180;
      const items = current.items.map((item, itemIndex) => itemIndex === index
        ? { ...item, rot: rotation }
        : item);
      G.arena.obstacles = sanitizeObstacleConfig({ ...current, items });
      saveArenaConfig();
      G.arenaObstaclePreview = null;
      updateObstacleControls();
      drawArenaPreview();
    });
  }
  if (dom.obstacleEnabled) {
    dom.obstacleEnabled.addEventListener('change', () => {
      const current = sanitizeObstacleConfig(G.arena.obstacles);
      if (current.count > 0) G.obstacleLastCount = current.count;
      const count = dom.obstacleEnabled.checked
        ? Math.max(1, G.obstacleLastCount || DEFAULT_OBSTACLE_CONFIG.count)
        : 0;
      let items = current.items;
      if (current.placement === 'custom' && count > 0) {
        items = items.slice();
        while (items.length < count) {
          items.push(createCustomObstacleItem(current, items.length));
        }
      }
      G.arena.obstacles = sanitizeObstacleConfig({ ...current, count, items });
      saveArenaConfig();
      G.arenaObstaclePreview = null;
      updateArenaUI();
      audio.init();
      audio.ui();
    });
  }
  dom.obstacleTypeButtons.forEach((button) => {
    button.addEventListener('click', () => toggleObstacleType(button.dataset.obstacleType));
  });
  dom.obstacleShapeButtons.forEach((button) => {
    button.addEventListener('click', () => toggleObstacleShape(button.dataset.obstacleShape));
  });
  dom.arenaShapeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      audio.init();
      audio.ui();
      applyArenaConfig(btn.dataset.shape, G.arena.size, { effects: true });
    });
  });
  dom.arenaSizeRange.addEventListener('input', () => {
    const size = Number(dom.arenaSizeRange.value) / 100;
    applyArenaConfig(G.arena.shape, size);
  });
  dom.turnLimitRange.addEventListener('input', () => {
    G.arena.turnLimit = clamp(Math.round(Number(dom.turnLimitRange.value) || 0), 0, ARENA_MAX_TURN_LIMIT);
    saveArenaConfig();
    updateShrinkControls();
  });
  dom.shrinkRateRange.addEventListener('input', () => {
    G.arena.shrinkRate = clamp(Math.round(Number(dom.shrinkRateRange.value) || ARENA_DEFAULT_SHRINK_RATE), 2, 15);
    saveArenaConfig();
    updateShrinkControls();
  });
  function arenaPreviewRadius() {
    return Math.min(215, 140 * G.arena.size);
  }

  function arenaPreviewNormalizedPoint(event) {
    if (!dom.arenaPreview) return null;
    const rect = dom.arenaPreview.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const px = (event.clientX - rect.left) / rect.width * dom.arenaPreview.width;
    const py = (event.clientY - rect.top) / rect.height * dom.arenaPreview.height;
    const cx = dom.arenaPreview.width / 2;
    const cy = dom.arenaPreview.height / 2 - 2;
    const radius = arenaPreviewRadius();
    return { x: (px - cx) / radius, y: (py - cy) / radius };
  }

  function pickCustomObstacleAt(point) {
    const config = sanitizeObstacleConfig(G.arena.obstacles);
    if (config.placement !== 'custom') return -1;
    for (let i = config.items.length - 1; i >= 0; i -= 1) {
      const item = config.items[i];
      const radius = item.size / 100;
      if (Math.hypot(point.x - item.x, point.y - item.y) <= radius + 0.045) return i;
    }
    return -1;
  }

  function updateCustomObstaclePosition(index, point) {
    const config = sanitizeObstacleConfig(G.arena.obstacles);
    if (config.placement !== 'custom' || !config.items[index]) return;
    const item = config.items[index];
    const angle = Math.atan2(point.y, point.x);
    const boundary = getArenaBoundaryAtAngle(angle);
    const boundaryNorm = boundary ? Math.hypot(boundary.x, boundary.y) / Math.max(1, R) : 1;
    const maxDistance = Math.max(0.05, boundaryNorm - item.size / 100 - 0.02);
    let x = point.x;
    let y = point.y;
    const distance = Math.hypot(x, y);
    if (distance > maxDistance) {
      x = x / distance * maxDistance;
      y = y / distance * maxDistance;
    }
    const items = config.items.map((entry, itemIndex) => itemIndex === index
      ? { ...entry, x, y }
      : entry);
    G.arena.obstacles = sanitizeObstacleConfig({ ...config, items });
    G.arenaObstaclePreview = null;
    drawArenaPreview();
  }

  let arenaObstacleDrag = null;
  if (dom.arenaPreview) {
    dom.arenaPreview.addEventListener('pointerdown', (event) => {
      if (!G.arenaOpen || !G.arena.obstacles || G.arena.obstacles.placement !== 'custom') return;
      const point = arenaPreviewNormalizedPoint(event);
      if (!point) return;
      const index = pickCustomObstacleAt(point);
      if (index < 0) return;
      event.preventDefault();
      G.arenaObstacleSelected = index;
      arenaObstacleDrag = { index, pointerId: event.pointerId };
      try {
        dom.arenaPreview.setPointerCapture(event.pointerId);
      } catch (error) {
        /* optional */
      }
      updateObstacleControls();
      G.arenaObstaclePreview = null;
      drawArenaPreview();
    });
    dom.arenaPreview.addEventListener('pointermove', (event) => {
      if (!arenaObstacleDrag || arenaObstacleDrag.pointerId !== event.pointerId) return;
      const point = arenaPreviewNormalizedPoint(event);
      if (!point) return;
      event.preventDefault();
      updateCustomObstaclePosition(arenaObstacleDrag.index, point);
    });
    const endObstacleDrag = (event) => {
      if (!arenaObstacleDrag || arenaObstacleDrag.pointerId !== event.pointerId) return;
      arenaObstacleDrag = null;
      saveArenaConfig();
    };
    dom.arenaPreview.addEventListener('pointerup', endObstacleDrag);
    dom.arenaPreview.addEventListener('pointercancel', endObstacleDrag);
  }

  dom.arena.querySelector('.modal-backdrop').addEventListener('click', () => closeArena());
  dom.arena.addEventListener('click', (e) => {
    if (e.target === dom.arena) closeArena();
  });
  dom.selectedCoinBtn.addEventListener('click', openCodex);
  dom.matchSizeButtons.forEach((btn) => {
    btn.addEventListener('click', () => selectMatchSize(btn.dataset.size));
  });
  if (dom.matchSizeRange) {
    dom.matchSizeRange.addEventListener('input', () => selectMatchSize(dom.matchSizeRange.value));
  }
  dom.modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => selectMode(btn.dataset.mode));
  });
  dom.chaseHpButtons.forEach((btn) => {
    btn.addEventListener('click', () => selectChaseHp(btn.dataset.hp));
  });
  dom.rosterInspectBtn.addEventListener('click', () => openInspect(G.active ? G.active.id : G.playerId));
  dom.rosterHideBtn.addEventListener('click', () => setRosterHidden(true));
  dom.rosterShowBtn.addEventListener('click', () => setRosterHidden(false));
  dom.inspectClose.addEventListener('click', () => closeInspect());
  dom.inspectResume.addEventListener('click', () => closeInspect());
  dom.inspect.querySelector('.modal-backdrop').addEventListener('click', () => closeInspect());
  dom.inspect.addEventListener('click', (e) => {
    if (e.target === dom.inspect) closeInspect();
  });
  dom.codexClose.addEventListener('click', () => closeCodex());
  dom.codexDone.addEventListener('click', () => closeCodex());
  dom.codexSelectBtn.addEventListener('click', () => {
    selectPlayer(G.codexPreviewId);
    closeCodex();
  });
  dom.codex.querySelector('.modal-backdrop').addEventListener('click', () => closeCodex());
  dom.codex.addEventListener('click', (e) => {
    if (e.target === dom.codex) closeCodex();
  });
  dom.difficultyButtons.forEach((btn) => {
    btn.addEventListener('click', () => selectDifficulty(btn.dataset.difficulty));
  });
  dom.personalityPoolBtn.addEventListener('click', openPersonalityPool);
  dom.personalityPoolClose.addEventListener('click', () => closePersonalityPool());
  dom.personalityPoolDone.addEventListener('click', () => closePersonalityPool());
  dom.personalityPoolAll.addEventListener('click', selectAllPersonalities);
  dom.personalityPoolDefault.addEventListener('click', selectAllPersonalities);
  dom.personalityPoolList.addEventListener('click', (event) => {
    const option = event.target.closest('[data-personality]');
    if (option) togglePersonality(option.dataset.personality);
  });
  dom.personalityPool.querySelector('.modal-backdrop').addEventListener('click', () => closePersonalityPool());
  dom.personalityPool.addEventListener('click', (event) => {
    if (event.target === dom.personalityPool) closePersonalityPool();
  });
  dom.helpBtn.addEventListener('click', openHelp);
  dom.helpClose.addEventListener('click', () => closeHelp());
  dom.helpCloseBtn.addEventListener('click', () => closeHelp());
  dom.helpStartBtn.addEventListener('click', () => {
    closeHelp(true);
    startGame();
  });
  dom.help.querySelector('.modal-backdrop').addEventListener('click', () => closeHelp());
  dom.help.addEventListener('click', (e) => {
    if (e.target === dom.help) closeHelp();
  });
  dom.returnRoomBtn.addEventListener('click', returnToOnlineRoom);
  dom.playAgainBtn.addEventListener('click', () => {
    if (G.online && G.online.active) {
      if (G.online.role === 'host') onlineRematch();
      else addToast('等待房主重新开始', 'info', 1600);
      return;
    }
    startGame();
  });
  dom.backToMenuBtn.addEventListener('click', () => {
    if (G.online && G.online.active) onlineLeaveGame();
    else returnToMenu();
  });
  dom.soundToggle.addEventListener('click', toggleSound);
  dom.fullscreenToggle.addEventListener('click', toggleFullscreen);
  dom.restartBtn.addEventListener('click', () => {
    audio.ui();
    startGame();
  });
  dom.zoomIn.addEventListener('click', () => {
    audio.ui();
    zoomAt(G.width / 2, G.height / 2, 1.2);
  });
  dom.zoomOut.addEventListener('click', () => {
    audio.ui();
    zoomAt(G.width / 2, G.height / 2, 1 / 1.2);
  });

  /* =========================================================
     Boot
     ========================================================= */
  function setInitialSoundUI() {
    dom.soundToggle.classList.toggle('sound-muted', audio.muted);
    dom.soundToggle.setAttribute('aria-label', audio.muted ? '开启声音' : '关闭声音');
  }

  function boot() {
    initRoster();
    renderCodexList();
    applyPlayerSelection();
    applyDifficultyUI();
    applyMatchSizeUI();
    applyModeUI();
    resize();
    G.texture = buildArenaTexture();
    G.coins = createCoins(true);
    G.camera.zoom = G.baseZoom;
    G.camera.tzoom = G.baseZoom;
    G.phase = 'menu';
    dom.hud.setAttribute('aria-hidden', 'true');
    dom.help.setAttribute('aria-hidden', 'true');
    dom.arena.setAttribute('aria-hidden', 'true');
    dom.result.setAttribute('aria-hidden', 'true');
    setInitialSoundUI();
    updateZoomLabel();
    updateRoster();
    updateArenaUI();
    requestAnimationFrame(frame);
    setTimeout(maybeJoinFromInvite, 300);
  }

  function frame(tsMs) {
    const ts = tsMs / 1000;
    let dt = ts - G.lastFrame;
    if (!Number.isFinite(dt) || dt < 0) dt = 0.016;
    dt = Math.min(0.05, dt);
    G.lastFrame = ts;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  // Test / automation hook. Harmless in normal play, useful for smoke tests.
  window.__EDGE_COIN__ = {
    startGame,
    returnToMenu,
    getState: () => ({
      phase: G.phase,
      playerId: G.playerId,
      online: G.online ? {
        role: G.online.role,
        code: G.online.code,
        active: !!G.online.active,
        connected: !!G.online.connected,
        peerConnected: !!G.online.peerConnected,
        localCoin: G.online.localCoin,
        hostCoin: G.online.hostCoin,
        mode: G.online.mode,
        roomArena: G.online.room ? G.online.room.arena : null,
        selfSlot: G.online.selfSlot,
        matchSize: G.online.matchSize,
        participants: G.online.participants,
        controllers: G.online.controllers,
        names: G.online.names,
        activeName: G.online.activeName || null,
        activeType: G.online.activeType || null,
        shotSent: !!G.online.shotSent,
        lastTurn: G.online.lastTurn || 0,
      } : null,
      difficulty: G.difficulty,
      matchSize: G.matchSize,
      mode: G.mode,
      participants: G.participants.slice(),
      curveInput: { left: !!G.curveInput.left, right: !!G.curveInput.right },
      inspectOpen: G.inspectOpen,
      arena: { ...G.arena },
      walls: G.arena.walls && G.arena.walls[G.arena.shape]
        ? G.arena.walls[G.arena.shape].slice()
        : null,
      active: G.active ? G.active.id : null,
      aim: {
        angle: G.aim.angle,
        power: G.aim.power,
        charging: G.aim.charging,
      },
      anchorBonus: G.anchorBonus ? { ...G.anchorBonus } : null,
      aiPlan: G.ai.plan ? {
        angle: G.ai.plan.angle,
        power: G.ai.plan.power,
        target: G.ai.plan.target ? G.ai.plan.target.id : null,
        personality: G.ai.plan.personality || null,
      } : null,
      turn: G.turn,
      alive: G.coins.filter((c) => c.alive).length,
      power: G.aim.power,
      charging: G.aim.charging,
      aimPower: G.aim.power,
      camera: { zoom: G.camera.zoom, x: G.camera.x, y: G.camera.y },
      coins: G.coins.map((c) => ({
        id: c.id,
        x: Math.round(c.x),
        y: Math.round(c.y),
        vx: Math.round(c.vx),
        vy: Math.round(c.vy),
        rot: Math.round(c.rot * 1000) / 1000,
        radius: c.radius,
        seed: c.visualSeed,
        spawnDelay: Math.round(c.spawnDelay * 1000) / 1000,
        speed: Math.round(Math.hypot(c.vx, c.vy)),
        alive: c.alive,
        locked: !!c.locked,
        volleySkipped: !!c.volleySkipped,
        danger: Number(c.danger.toFixed(2)),
        hasFired: c.hasFired,
        protected: isFirstShotProtected(c),
        marker: c.marker ? { x: Math.round(c.marker.x), y: Math.round(c.marker.y) } : null,
        skillCooldown: c.skillCooldown || 0,
        skillReady: !!c.skillReady,
        anchorHeld: !!c.anchorHeld,
        personality: c.personality ? c.personality.id : null,
        energy: c.def.id === 'curve' ? Number(c.energy) || 0 : null,
        curveActive: !!c.curveActive,
        curveHold: Number(c.curveHold) || 0,
        curveTrail: c.curveTrail ? c.curveTrail.length : 0,
        blackdogFx: !!c.blackdogFxTriggered,
      })),
      stats: { ...G.stats },
      obstacles: G.obstacles.map((obstacle) => ({
        id: obstacle.id,
        shape: obstacle.shape,
        type: obstacle.type,
        x: Math.round(obstacle.x),
        y: Math.round(obstacle.y),
        vx: Math.round(obstacle.vx),
        vy: Math.round(obstacle.vy),
        radius: Math.round(obstacle.radius),
        rot: Number((obstacle.rot || 0).toFixed(3)),
      })),
      arenaObstacleConfig: sanitizeObstacleConfig(G.arena.obstacles),
      volley: G.volley ? {
        round: G.volley.round,
        alive: G.volley.alive,
        locked: G.volley.locked,
        firing: !!G.volley.firing,
        playerLocked: !!G.volley.playerLocked,
      } : null,
      chaseHp: G.chaseHp,
      chase: G.chase ? {
        phase: G.phase,
        hp: G.chase.hp,
        maxHp: G.chase.maxHp,
        moves: G.chase.moves,
        totalMoves: G.chase.totalMoves,
        enemyActive: G.chase.enemyActive,
        pulseTimer: G.chase.pulseTimer,
        exit: { x: Math.round(G.chase.exit.x), y: Math.round(G.chase.exit.y) },
        player: {
          x: Math.round(G.chase.player.x),
          y: Math.round(G.chase.player.y),
          speed: Math.round(Math.hypot(G.chase.player.vx, G.chase.player.vy)),
        },
        enemies: G.chase.enemies.map((enemy) => ({
          x: Math.round(enemy.x),
          y: Math.round(enemy.y),
          role: enemy.role ? enemy.role.id : null,
          def: enemy.def.id,
          speed: Math.round(Math.hypot(enemy.vx, enemy.vy)),
        })),
        walls: G.chase.maze.walls.length,
      } : null,
      pending: G.pending,
    }),
    selectChaseHp: (hp) => selectChaseHp(hp),
    chaseWarp: (x, y) => {
      if (!G.chase || G.chase.over) return;
      G.chase.player.x = Number(x);
      G.chase.player.y = Number(y);
      G.chase.player.vx = 0;
      G.chase.player.vy = 0;
    },
    chaseFinish: (win) => finishChase(!!win),
    fire: (angle, power) => {
      if (G.phase === 'playerAim' && G.active) fireCoin(G.active, angle, power);
      else if (G.phase === 'volleyAim' && !G.playerOut) {
        G.aim.angle = angle;
        G.aim.power = clamp(power, 0, 1);
        lockPlayerVolley();
      }
    },
    selectPlayer,
    selectDifficulty,
    selectMatchSize,
    selectMode,
    setAIPersonality: (coinId, personalityId) => {
      const coin = G.coins.find((item) => item.id === coinId);
      const personality = AI_PERSONALITIES.find((item) => item.id === personalityId);
      if (!coin || !personality || coin.id === G.playerId) return false;
      coin.personality = personality;
      syncAIPersonaButton();
      return true;
    },
    meow: () => audio.meow(),
    openCodex,
    closeCodex,
    openInspect,
    closeInspect,
    setArena: (shape, size) => applyArenaConfig(shape, size, { effects: true }),
    setSuddenDeath: (limit, rate) => {
      G.arena.turnLimit = clamp(Math.round(Number(limit) || 0), 0, ARENA_MAX_TURN_LIMIT);
      G.arena.shrinkRate = clamp(Math.round(Number(rate) || ARENA_DEFAULT_SHRINK_RATE), 2, 15);
      saveArenaConfig();
      updateArenaUI();
    },
    skillMetrics: (id, power = 1) => {
      const def = DEF_BY_ID[id];
      if (!def) return null;
      const p = clamp(Number(power) || 0, 0, 1);
      const coin = { def };
      return {
        base: lerp(def.launchMin, def.launchMax, p),
        launch: launchSpeedForPower(coin, p),
        friction: shotFrictionScale(coin, p),
      };
    },
    openArena,
    closeArena,
    eliminate: (id) => {
      const coin = G.coins.find((c) => c.id === id);
      if (coin && coin.alive) {
        coin.lastHitBy = id === G.playerId ? null : G.playerId;
        eliminateCoin(coin);
      }
    },
    zoom: (factor) => zoomAt(G.width / 2, G.height / 2, factor),
    skipIntro: () => {
      if (G.phase === 'intro') {
        G.introT = 2;
        beginNextRound();
      }
    },
    setTimeScale: (v) => {
      G.timeScale = v;
    },
  };

  boot();
})();
