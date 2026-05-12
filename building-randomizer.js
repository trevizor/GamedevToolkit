(function initBuildingPlanRandomizer(global) {
  "use strict";

  function toFiniteNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clampInt(value, minValue, fallback) {
    const parsed = Math.floor(toFiniteNumber(value, fallback));
    return Math.max(minValue, parsed);
  }

  function createSeededRng(seed) {
    let state = (seed >>> 0) || 1;
    return function next() {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function midpoint(a, b) {
    return {
      x: (Number(a.x) + Number(b.x)) * 0.5,
      y: (Number(a.y) + Number(b.y)) * 0.5
    };
  }

  function normalizePlanData(rawPlan) {
    if (!rawPlan || typeof rawPlan !== "object") {
      return null;
    }

    if (Array.isArray(rawPlan.floors) && rawPlan.floors.length > 0) {
      return rawPlan;
    }

    const fallbackSegments = Array.isArray(rawPlan.segments) ? rawPlan.segments : [];
    const clone = deepClone(rawPlan);
    clone.floors = [
      {
        name: "Level 1",
        segments: fallbackSegments,
        slabBoxes: [],
        ramps: [],
        placeObjects: []
      }
    ];
    return clone;
  }

  function extractLevelZeroDoorConnectors(plan) {
    const out = [];
    if (!plan || !Array.isArray(plan.floors) || plan.floors.length === 0) {
      return out;
    }

    const firstFloor = plan.floors[0] || {};
    const segments = Array.isArray(firstFloor.segments) ? firstFloor.segments : [];
    const objects = Array.isArray(firstFloor.placeObjects) ? firstFloor.placeObjects : [];

    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i];
      if (!seg || !seg.a || !seg.b) {
        continue;
      }
      if (String(seg.type || "").toLowerCase() !== "door") {
        continue;
      }
      out.push({
        source: "segment-door",
        x: midpoint(seg.a, seg.b).x,
        y: midpoint(seg.a, seg.b).y,
        rotation: Math.atan2(Number(seg.b.y) - Number(seg.a.y), Number(seg.b.x) - Number(seg.a.x)) * (180 / Math.PI)
      });
    }

    for (let i = 0; i < objects.length; i += 1) {
      const obj = objects[i];
      if (!obj) {
        continue;
      }
      if (String(obj.type || "").toLowerCase() !== "doorprefab") {
        continue;
      }
      const x = Number(obj.cx);
      const y = Number(obj.cy);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        continue;
      }
      out.push({
        source: "door-prefab",
        x,
        y,
        rotation: Number(obj.rotation) || 0
      });
    }

    return out;
  }

  function chooseFarthestConnectorPair(connectors) {
    if (!Array.isArray(connectors) || connectors.length < 2) {
      return null;
    }

    let bestI = 0;
    let bestJ = 1;
    let bestDistSq = -1;

    for (let i = 0; i < connectors.length; i += 1) {
      for (let j = i + 1; j < connectors.length; j += 1) {
        const dx = Number(connectors[i].x) - Number(connectors[j].x);
        const dy = Number(connectors[i].y) - Number(connectors[j].y);
        const distSq = dx * dx + dy * dy;
        if (distSq > bestDistSq) {
          bestDistSq = distSq;
          bestI = i;
          bestJ = j;
        }
      }
    }

    return {
      ai: bestI,
      bi: bestJ,
      a: deepClone(connectors[bestI]),
      b: deepClone(connectors[bestJ]),
      distance: Math.sqrt(bestDistSq)
    };
  }

  function chooseSpreadConnectors(connectors, desiredCount) {
    if (!Array.isArray(connectors) || connectors.length === 0) {
      return [];
    }

    const count = Math.max(1, Math.min(clampInt(desiredCount, 1, 4), connectors.length));
    if (count === 1) {
      return [deepClone(connectors[0])];
    }

    if (count === 2) {
      const pair = chooseFarthestConnectorPair(connectors);
      return pair ? [pair.a, pair.b] : [deepClone(connectors[0]), deepClone(connectors[1])];
    }

    const picked = [];
    const used = new Set();
    const farthest = chooseFarthestConnectorPair(connectors);
    if (farthest) {
      const idxA = farthest.ai;
      const idxB = farthest.bi;
      if (idxA >= 0) {
        used.add(idxA);
        picked.push(deepClone(connectors[idxA]));
      }
      if (idxB >= 0 && !used.has(idxB)) {
        used.add(idxB);
        picked.push(deepClone(connectors[idxB]));
      }
    }

    while (picked.length < count) {
      let bestIndex = -1;
      let bestScore = -1;
      for (let i = 0; i < connectors.length; i += 1) {
        if (used.has(i)) {
          continue;
        }
        let minDistSq = Number.POSITIVE_INFINITY;
        for (let j = 0; j < picked.length; j += 1) {
          const dx = Number(connectors[i].x) - Number(picked[j].x);
          const dy = Number(connectors[i].y) - Number(picked[j].y);
          const distSq = dx * dx + dy * dy;
          if (distSq < minDistSq) {
            minDistSq = distSq;
          }
        }
        const score = picked.length === 0 ? 0 : minDistSq;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }

      if (bestIndex < 0) {
        break;
      }
      used.add(bestIndex);
      picked.push(deepClone(connectors[bestIndex]));
    }

    return picked;
  }

  function normalizeRotationDegrees(value) {
    let deg = Number(value) || 0;
    while (deg < 0) {
      deg += 360;
    }
    while (deg >= 360) {
      deg -= 360;
    }
    return deg;
  }

  function rotatePoint(point, angleDeg) {
    const rad = (Number(angleDeg) || 0) * (Math.PI / 180);
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    return {
      x: Number(point.x) * c - Number(point.y) * s,
      y: Number(point.x) * s + Number(point.y) * c
    };
  }

  function transformPoint(point, rotationDeg, translation) {
    const rotated = rotatePoint(point, rotationDeg);
    return {
      x: rotated.x + Number(translation.x),
      y: rotated.y + Number(translation.y)
    };
  }

  function getFloorSlabBoxesLevelZero(plan) {
    if (!plan || !Array.isArray(plan.floors) || plan.floors.length === 0) {
      return [];
    }

    const firstFloor = plan.floors[0] || {};
    const slabs = Array.isArray(firstFloor.slabBoxes) ? firstFloor.slabBoxes : [];
    const out = [];
    for (let i = 0; i < slabs.length; i += 1) {
      const slab = slabs[i];
      if (!slab) {
        continue;
      }
      const type = String(slab.type || "floor").toLowerCase();
      if (type !== "floor") {
        continue;
      }
      const sx = Number(slab.sx);
      const sy = Number(slab.sy);
      const cx = Number(slab.cx);
      const cy = Number(slab.cy);
      if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(cx) || !Number.isFinite(cy)) {
        continue;
      }
      out.push({
        cx,
        cy,
        sx: Math.abs(sx),
        sy: Math.abs(sy),
        rotation: Number(slab.rotation) || 0
      });
    }
    return out;
  }

  function transformFloorSlabBox(box, roomRotationDeg, roomTranslation) {
    const center = transformPoint({ x: box.cx, y: box.cy }, roomRotationDeg, roomTranslation);
    return {
      cx: center.x,
      cy: center.y,
      sx: box.sx,
      sy: box.sy,
      rotation: normalizeRotationDegrees((Number(box.rotation) || 0) + roomRotationDeg)
    };
  }

  function isPointInsideRotatedRect(point, rect) {
    const local = rotatePoint(
      {
        x: Number(point.x) - Number(rect.cx),
        y: Number(point.y) - Number(rect.cy)
      },
      -Number(rect.rotation || 0)
    );
    const hx = Math.abs(Number(rect.sx)) * 0.5;
    const hy = Math.abs(Number(rect.sy)) * 0.5;
    return Math.abs(local.x) <= hx && Math.abs(local.y) <= hy;
  }

  function mergePlans(basePlan, sourcePlan, roomRotationDeg, roomTranslation) {
    const out = deepClone(basePlan);
    if (!Array.isArray(out.floors)) {
      out.floors = [];
    }

    const sourceFloors = Array.isArray(sourcePlan.floors) ? sourcePlan.floors : [];
    for (let floorIndex = 0; floorIndex < sourceFloors.length; floorIndex += 1) {
      const sourceFloor = sourceFloors[floorIndex] || {};
      if (!out.floors[floorIndex]) {
        out.floors[floorIndex] = {
          name: sourceFloor.name || "Level " + String(floorIndex + 1),
          segments: [],
          slabBoxes: [],
          ramps: [],
          placeObjects: []
        };
      }

      const targetFloor = out.floors[floorIndex];
      targetFloor.segments = Array.isArray(targetFloor.segments) ? targetFloor.segments : [];
      targetFloor.slabBoxes = Array.isArray(targetFloor.slabBoxes) ? targetFloor.slabBoxes : [];
      targetFloor.ramps = Array.isArray(targetFloor.ramps) ? targetFloor.ramps : [];
      targetFloor.placeObjects = Array.isArray(targetFloor.placeObjects) ? targetFloor.placeObjects : [];

      const segments = Array.isArray(sourceFloor.segments) ? sourceFloor.segments : [];
      for (let i = 0; i < segments.length; i += 1) {
        const seg = segments[i];
        if (!seg || !seg.a || !seg.b) {
          continue;
        }
        const a = transformPoint(seg.a, roomRotationDeg, roomTranslation);
        const b = transformPoint(seg.b, roomRotationDeg, roomTranslation);
        targetFloor.segments.push({
          a,
          b,
          type: seg.type || "wall"
        });
      }

      const slabs = Array.isArray(sourceFloor.slabBoxes) ? sourceFloor.slabBoxes : [];
      for (let i = 0; i < slabs.length; i += 1) {
        const slab = slabs[i];
        if (!slab) {
          continue;
        }
        const center = transformPoint({ x: Number(slab.cx), y: Number(slab.cy) }, roomRotationDeg, roomTranslation);
        targetFloor.slabBoxes.push({
          type: slab.type || "floor",
          cx: center.x,
          cy: center.y,
          sx: Number(slab.sx),
          sy: Number(slab.sy),
          rotation: normalizeRotationDegrees((Number(slab.rotation) || 0) + roomRotationDeg)
        });
      }

      const ramps = Array.isArray(sourceFloor.ramps) ? sourceFloor.ramps : [];
      for (let i = 0; i < ramps.length; i += 1) {
        const ramp = ramps[i];
        if (!ramp) {
          continue;
        }
        const center = transformPoint({ x: Number(ramp.cx), y: Number(ramp.cy) }, roomRotationDeg, roomTranslation);
        targetFloor.ramps.push({
          type: ramp.type || "full",
          cx: center.x,
          cy: center.y,
          sx: Number(ramp.sx),
          sy: Number(ramp.sy),
          rotation: normalizeRotationDegrees((Number(ramp.rotation) || 0) + roomRotationDeg),
          fromLevel: Number.isInteger(ramp.fromLevel) ? ramp.fromLevel : floorIndex,
          toLevel: Number.isInteger(ramp.toLevel) ? ramp.toLevel : (floorIndex + 1)
        });
      }

      const objects = Array.isArray(sourceFloor.placeObjects) ? sourceFloor.placeObjects : [];
      for (let i = 0; i < objects.length; i += 1) {
        const obj = objects[i];
        if (!obj) {
          continue;
        }
        const center = transformPoint({ x: Number(obj.cx), y: Number(obj.cy) }, roomRotationDeg, roomTranslation);
        targetFloor.placeObjects.push({
          type: obj.type || "generic",
          size: Number(obj.size),
          cx: center.x,
          cy: center.y,
          rotation: normalizeRotationDegrees((Number(obj.rotation) || 0) + roomRotationDeg)
        });
      }
    }

    return out;
  }

  async function loadRoomTemplatesFromFiles(fileList) {
    const files = Array.from(fileList || []);
    const templates = [];
    const errors = [];

    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const plan = normalizePlanData(parsed);
        if (!plan) {
          errors.push(file.name + ": Invalid plan JSON structure.");
          continue;
        }

        const connectors = extractLevelZeroDoorConnectors(plan);
        if (connectors.length < 2) {
          errors.push(file.name + ": Needs at least 2 level-0 door connectors.");
          continue;
        }

        const pair = chooseFarthestConnectorPair(connectors);
        if (!pair) {
          errors.push(file.name + ": Failed to resolve a connector pair.");
          continue;
        }

        templates.push({
          id: "room_" + (i + 1),
          name: file.name,
          plan,
          connectors,
          selectedConnectors: [pair.a, pair.b],
          selectedConnectorDistance: pair.distance
        });
      } catch (error) {
        errors.push(file.name + ": " + (error && error.message ? error.message : String(error)));
      }
    }

    return { templates, errors };
  }

  function generateMockBuilding(options) {
    const config = options || {};
    const templates = Array.isArray(config.templates) ? config.templates : [];

    if (templates.length === 0) {
      throw new Error("No valid room templates loaded.");
    }

    const seed = clampInt(config.seed, 0, 1337);
    const targetRooms = clampInt(config.targetRooms, 1, 8);
    const maxAttempts = clampInt(config.maxAttempts, 1, 60);
    const basePathCount = clampInt(config.basePathCount, 2, 4);
    const rng = createSeededRng(seed);

    const baseIndex = Math.floor(rng() * templates.length);
    const baseTemplate = templates[baseIndex];
    const targetSelection = Math.max(1, targetRooms);

    const placements = [];
    const floorSlabWorld = [];
    const openConnectors = [];

    const basePlacement = {
      template: baseTemplate,
      rotation: 0,
      translation: { x: 0, y: 0 }
    };
    placements.push(basePlacement);

    const baseSlabs = getFloorSlabBoxesLevelZero(baseTemplate.plan);
    for (let i = 0; i < baseSlabs.length; i += 1) {
      floorSlabWorld.push(transformFloorSlabBox(baseSlabs[i], 0, basePlacement.translation));
    }

    const baseConnectors = chooseSpreadConnectors(baseTemplate.connectors, basePathCount);
    for (let i = 0; i < baseConnectors.length; i += 1) {
      const worldConnector = transformPoint(baseConnectors[i], 0, basePlacement.translation);
      openConnectors.push({
        x: worldConnector.x,
        y: worldConnector.y,
        rotation: normalizeRotationDegrees(Number(baseConnectors[i].rotation) || 0)
      });
    }

    let attempts = 0;
    const maxTotalAttempts = maxAttempts * Math.max(1, targetSelection);
    while (placements.length < targetSelection && openConnectors.length > 0 && attempts < maxTotalAttempts) {
      attempts += 1;

      const openIndex = Math.floor(rng() * openConnectors.length);
      const targetConnector = openConnectors[openIndex];
      const templateIndex = Math.floor(rng() * templates.length);
      const nextTemplate = templates[templateIndex];

      const cA = nextTemplate.selectedConnectors[0];
      const cB = nextTemplate.selectedConnectors[1];

      const candidateRotation = normalizeRotationDegrees((Number(targetConnector.rotation) + 180) - Number(cA.rotation || 0));
      const transformedA = transformPoint(cA, candidateRotation, { x: 0, y: 0 });
      const translation = {
        x: Number(targetConnector.x) - transformedA.x,
        y: Number(targetConnector.y) - transformedA.y
      };

      const transformedB = transformPoint(cB, candidateRotation, translation);

      // Rule: only check intersections on the inserted room second pivot point, and only against floor slabs.
      let intersects = false;
      for (let i = 0; i < floorSlabWorld.length; i += 1) {
        if (isPointInsideRotatedRect(transformedB, floorSlabWorld[i])) {
          intersects = true;
          break;
        }
      }
      if (intersects) {
        continue;
      }

      placements.push({
        template: nextTemplate,
        rotation: candidateRotation,
        translation
      });

      openConnectors.splice(openIndex, 1);
      openConnectors.push({
        x: transformedB.x,
        y: transformedB.y,
        rotation: normalizeRotationDegrees((Number(cB.rotation) || 0) + candidateRotation)
      });

      const nextFloorSlabs = getFloorSlabBoxesLevelZero(nextTemplate.plan);
      for (let i = 0; i < nextFloorSlabs.length; i += 1) {
        floorSlabWorld.push(transformFloorSlabBox(nextFloorSlabs[i], candidateRotation, translation));
      }
    }

    let generatedPlan = deepClone(baseTemplate.plan);
    for (let i = 1; i < placements.length; i += 1) {
      generatedPlan = mergePlans(
        generatedPlan,
        placements[i].template.plan,
        placements[i].rotation,
        placements[i].translation
      );
    }

    const selectedRoomNames = [];
    for (let i = 0; i < placements.length; i += 1) {
      selectedRoomNames.push(placements[i].template.name);
    }

    generatedPlan.randomizerMeta = {
      mode: "stitch-v1",
      createdAtUtc: new Date().toISOString(),
      seed,
      targetRooms,
      maxAttempts,
      basePathCount,
      attemptsUsed: attempts,
      baseRoom: baseTemplate.name,
      selectedRooms: selectedRoomNames,
      roomsPlaced: placements.length,
      connectorSelectionPolicy: "use level-0 doors, choose farthest two when >2",
      intersectionRule: "check only inserted room second pivot against floor slabs"
    };

    return {
      plan: generatedPlan,
      summary: {
        templateCount: templates.length,
        baseRoomName: baseTemplate.name,
        targetRooms,
        maxAttempts,
        basePathCount,
        selectedRooms: selectedRoomNames,
        roomsPlaced: placements.length,
        attemptsUsed: attempts
      }
    };
  }

  global.BuildingPlanRandomizer = {
    loadRoomTemplatesFromFiles,
    generateMockBuilding
  };
})(window);
