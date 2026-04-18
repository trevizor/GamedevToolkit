using System;
using System.Collections.Generic;
using UnityEngine;

public class PlanJsonCubeSpawner : MonoBehaviour
{
    private const float HALF_WALL_HEIGHT_FACTOR = 0.5f;
    private const float SLAB_Y_OFFSET_FACTOR = 0.1f;

    [Header("Input")]
    [SerializeField] private TextAsset planJsonFile;

    [Header("Prefabs By Line Type")]
    [SerializeField] private GameObject wallPrefab;
    [SerializeField] private GameObject halfWallPrefab;
    [SerializeField] private GameObject doorPrefab;
    [SerializeField] private GameObject windowPrefab;
    [SerializeField] private GameObject floorPrefab;
    [SerializeField] private GameObject ceilingPrefab;
    [SerializeField] private GameObject halfWallSlabPrefab;
    [SerializeField] private GameObject rampPrefab;

    [Header("Spawn")]
    [SerializeField] private Transform spawnRoot;
    [SerializeField] private bool clearPreviousOnBuild = true;
    [SerializeField] private float defaultGridSizeUnits = 1.0f;

    [Header("Prefab Length Setup")]
    [SerializeField] private float prefabBaseLength = 1.0f;

    [Header("Debug")]
    [SerializeField] private bool logBuildSummary = true;

    [Serializable]
    private class PlanData
    {
        public int version;
        public string title;
        public float gridSizeUnits;
        public SettingsData settings;
        public int currentFloorIndex;
        public FloorData[] floors;
        public SegmentData[] segments; // Backwards compatibility from exporter
    }

    [Serializable]
    private class SettingsData
    {
        public float thickness;
        public float height;
        public string joinMode;
        public float doorHeight;
        public float doorWidth;
        public float windowGap;
    }

    [Serializable]
    private class FloorData
    {
        public string name;
        public SegmentData[] segments;
        public SlabBoxData[] slabBoxes;
        public RampData[] ramps;
    }

    [Serializable]
    private class SlabBoxData
    {
        public string type;
        public float cx;
        public float cy;
        public float sx;
        public float sy;
        public float rotation;
    }

    [Serializable]
    private class RampData
    {
        public string type;
        public float cx;
        public float cy;
        public float sx;
        public float sy;
        public float rotation;
        public int fromLevel;
        public int toLevel;
    }

    [Serializable]
    private class SegmentData
    {
        public PointData a;
        public PointData b;
        public string type;
    }

    [Serializable]
    private class PointData
    {
        public float x;
        public float y;
    }

    [ContextMenu("Build From Assigned JSON")]
    public void BuildFromAssignedJson()
    {
        if (planJsonFile == null)
        {
            Debug.LogError("PlanJsonCubeSpawner: No TextAsset assigned.", this);
            return;
        }

        BuildFromJsonText(planJsonFile.text);
    }

    public void BuildFromJsonText(string jsonText)
    {
        if (string.IsNullOrWhiteSpace(jsonText))
        {
            Debug.LogError("PlanJsonCubeSpawner: JSON text is empty.", this);
            return;
        }

        if (wallPrefab == null)
        {
            Debug.LogError("PlanJsonCubeSpawner: Assign at least the Wall prefab before building.", this);
            return;
        }

        PlanData plan;
        try
        {
            plan = JsonUtility.FromJson<PlanData>(jsonText);
        }
        catch (Exception ex)
        {
            Debug.LogError($"PlanJsonCubeSpawner: Failed to parse JSON. {ex.Message}", this);
            return;
        }

        if (plan == null)
        {
            Debug.LogError("PlanJsonCubeSpawner: Parsed plan is null.", this);
            return;
        }

        if (clearPreviousOnBuild)
        {
            ClearSpawned();
        }

        float grid = plan.gridSizeUnits > 0f ? plan.gridSizeUnits : defaultGridSizeUnits;
        float wallPrefabHeight = Mathf.Max(0.001f, EstimatePrefabHeight(wallPrefab));
        float wallPrefabThickness = Mathf.Max(0f, EstimatePrefabThickness(wallPrefab));
        float slabThickness = Mathf.Max(0.01f, wallPrefabThickness);
        float wallHeightFromPlan = (plan.settings != null && plan.settings.height > 0f)
            ? plan.settings.height
            : wallPrefabHeight;

        int spawnedLineCount = 0;
        int spawnedSlabCount = 0;
        int spawnedRampCount = 0;

        if (plan.floors != null && plan.floors.Length > 0)
        {
            float floorStride = wallPrefabHeight;
            for (int i = 0; i < plan.floors.Length; i++)
            {
                SegmentData[] segments = plan.floors[i] != null ? plan.floors[i].segments : null;
                float levelBaseY = i * floorStride;
                if (segments != null && segments.Length > 0)
                {
                    spawnedLineCount += SpawnSegments(segments, levelBaseY, grid, wallPrefabThickness);
                }

                SlabBoxData[] slabBoxes = plan.floors[i] != null ? plan.floors[i].slabBoxes : null;
                spawnedSlabCount += SpawnSlabBoxes(slabBoxes, levelBaseY, grid, wallHeightFromPlan, slabThickness);

                RampData[] ramps = plan.floors[i] != null ? plan.floors[i].ramps : null;
                spawnedRampCount += SpawnRamps(ramps, i, grid, floorStride, wallHeightFromPlan, slabThickness);
            }
        }
        else if (plan.segments != null && plan.segments.Length > 0)
        {
            spawnedLineCount += SpawnSegments(plan.segments, 0f, grid, wallPrefabThickness);
        }
        else
        {
            Debug.LogWarning("PlanJsonCubeSpawner: No line segments found in JSON.", this);
        }

        if (logBuildSummary)
        {
            Debug.Log($"PlanJsonCubeSpawner: Spawn complete. Line prefabs: {spawnedLineCount}, slab prefabs: {spawnedSlabCount}, ramp prefabs: {spawnedRampCount}", this);
        }
    }

    private int SpawnRamps(
        RampData[] ramps,
        int currentFloorIndex,
        float gridSize,
        float floorStride,
        float wallHeight,
        float slabThickness)
    {
        if (ramps == null || ramps.Length == 0 || rampPrefab == null)
        {
            return 0;
        }

        int count = 0;

        for (int i = 0; i < ramps.Length; i++)
        {
            RampData ramp = ramps[i];
            if (ramp == null)
            {
                continue;
            }

            float sx = ramp.sx * gridSize;
            float sz = ramp.sy * gridSize;
            if (!float.IsFinite(sx) || !float.IsFinite(sz) || sx <= 0.0001f || sz <= 0.0001f)
            {
                continue;
            }

            float px = ramp.cx * gridSize;
            float pz = ramp.cy * gridSize;
            if (!float.IsFinite(px) || !float.IsFinite(pz))
            {
                continue;
            }

            int fromLevel = ramp.fromLevel >= 0 ? ramp.fromLevel : currentFloorIndex;
            int toLevel = ramp.toLevel >= 0 ? ramp.toLevel : (currentFloorIndex + 1);
            float startY = fromLevel * floorStride;
            string rampType = string.IsNullOrWhiteSpace(ramp.type) ? "full" : ramp.type.Trim().ToLowerInvariant();
            bool isHalfRamp = rampType == "half";
            float endY = isHalfRamp
                ? startY + wallHeight * HALF_WALL_HEIGHT_FACTOR + slabThickness * SLAB_Y_OFFSET_FACTOR
                : toLevel * floorStride;
            float rise = Mathf.Abs(endY - startY);
            if (rise <= 0.0001f)
            {
                continue;
            }

            float centerY = Mathf.Min(startY, endY) + rise * 0.5f;
            Vector3 localPos = new Vector3(px, centerY, pz);
            Quaternion localRot = Quaternion.Euler(0f, ramp.rotation, 0f);
            Vector3 localScale = new Vector3(sx, rise, sz);

            SpawnPrefab(rampPrefab, localPos, localRot, localScale);
            count += 1;
        }

        return count;
    }

    private int SpawnSegments(
        SegmentData[] segments,
        float levelBaseY,
        float gridSize,
        float wallThickness)
    {
        int count = 0;
        Dictionary<string, int> wallEndpointUsage = BuildWallEndpointUsage(segments, gridSize);

        for (int i = 0; i < segments.Length; i++)
        {
            SegmentData seg = segments[i];
            if (!IsValidSegment(seg))
            {
                continue;
            }

            string type = string.IsNullOrWhiteSpace(seg.type) ? "wall" : seg.type.Trim().ToLowerInvariant();

            Vector2 start = new Vector2(seg.a.x * gridSize, seg.a.y * gridSize);
            Vector2 end = new Vector2(seg.b.x * gridSize, seg.b.y * gridSize);

            if ((end - start).sqrMagnitude < 0.000001f)
            {
                continue;
            }

            GameObject prefab = ResolvePrefabForType(type);
            if (prefab == null)
            {
                continue;
            }

            float trimAtStart = 0f;
            float extendAtEnd = 0f;
            if (IsWallLikeType(type))
            {
                string startKey = BuildEndpointKey(start);
                string endKey = BuildEndpointKey(end);
                bool hasStartJoin = wallEndpointUsage.TryGetValue(startKey, out int startCount) && startCount > 1;
                bool hasEndJoin = wallEndpointUsage.TryGetValue(endKey, out int endCount) && endCount > 1;

                float joinCompensation = wallThickness * 0.5f;
                trimAtStart = hasStartJoin ? joinCompensation : 0f;
                extendAtEnd = hasEndJoin ? joinCompensation : 0f;
            }

            SpawnSegmentPrefab(prefab, start, end, levelBaseY, trimAtStart, extendAtEnd);
            count += 1;
        }

        return count;
    }

    private GameObject ResolvePrefabForType(string type)
    {
        switch (type)
        {
            case "wall":
                return wallPrefab;
            case "halfwall":
                return halfWallPrefab != null ? halfWallPrefab : wallPrefab;
            case "door":
                return doorPrefab != null ? doorPrefab : wallPrefab;
            case "window":
                return windowPrefab != null ? windowPrefab : wallPrefab;
            default:
                return wallPrefab;
        }
    }

    private int SpawnSlabBoxes(
        SlabBoxData[] slabBoxes,
        float levelBaseY,
        float gridSize,
        float wallHeight,
        float slabThickness)
    {
        if (slabBoxes == null || slabBoxes.Length == 0)
        {
            return 0;
        }

        int count = 0;
        float safeThickness = Mathf.Max(0.01f, slabThickness);

        for (int i = 0; i < slabBoxes.Length; i++)
        {
            SlabBoxData box = slabBoxes[i];
            if (box == null)
            {
                continue;
            }

            string slabType = string.IsNullOrWhiteSpace(box.type) ? "floor" : box.type.Trim().ToLowerInvariant();
            bool isCeiling = slabType == "ceiling";
            bool isHalfWall = slabType == "halfwall";
            GameObject slabPrefab = isCeiling
                ? ceilingPrefab
                : isHalfWall
                    ? (halfWallSlabPrefab != null ? halfWallSlabPrefab : floorPrefab)
                    : floorPrefab;
            if (slabPrefab == null)
            {
                continue;
            }

            float sx = box.sx * gridSize;
            float sz = box.sy * gridSize;
            if (!float.IsFinite(sx) || !float.IsFinite(sz) || sx <= 0.0001f || sz <= 0.0001f)
            {
                continue;
            }

            float px = box.cx * gridSize;
            float pz = box.cy * gridSize;
            if (!float.IsFinite(px) || !float.IsFinite(pz))
            {
                continue;
            }

            float y;
            if (isCeiling)
            {
                y = levelBaseY + wallHeight + safeThickness * 0.5f;
            }
            else if (isHalfWall)
            {
                float halfWallTop = levelBaseY + wallHeight * HALF_WALL_HEIGHT_FACTOR;
                y = halfWallTop - safeThickness * 0.5f;
            }
            else
            {
                y = levelBaseY - safeThickness * 0.5f;
            }

            if (!isCeiling)
            {
                y += safeThickness * SLAB_Y_OFFSET_FACTOR;
            }

            Vector3 localPos = new Vector3(px, y, pz);
            Quaternion localRot = Quaternion.Euler(0f, box.rotation, 0f);
            Vector3 localScale = new Vector3(sx, safeThickness, sz);

            SpawnPrefab(slabPrefab, localPos, localRot, localScale);
            count += 1;
        }

        return count;
    }

    private void SpawnSegmentPrefab(
        GameObject prefab,
        Vector2 start,
        Vector2 end,
        float levelBaseY,
        float trimAtStart,
        float extendAtEnd)
    {
        Vector2 delta = end - start;
        float len = delta.magnitude;
        if (len <= 0.0001f)
        {
            return;
        }

        Vector2 dir = delta / len;
        float safeTrimAtStart = Mathf.Clamp(trimAtStart, 0f, len - 0.0001f);
        float safeExtendAtEnd = Mathf.Max(0f, extendAtEnd);

        // For start-pivoted prefabs, trim joined starts and extend joined ends by matching amounts.
        float adjustedLength = (len - safeTrimAtStart) + safeExtendAtEnd;
        if (adjustedLength <= 0.0001f)
        {
            return;
        }

        Vector2 adjustedStart = start + dir * safeTrimAtStart;
        Vector3 worldPos = new Vector3(adjustedStart.x, levelBaseY, adjustedStart.y);
        Vector3 dir3 = new Vector3(dir.x, 0f, dir.y);
        Quaternion rot = BuildTopViewRotation(dir3);
        Vector3 scale = BuildScaledLength(prefab.transform.localScale, adjustedLength);

        SpawnPrefab(prefab, worldPos, rot, scale);
    }

    private Dictionary<string, int> BuildWallEndpointUsage(SegmentData[] segments, float gridSize)
    {
        Dictionary<string, int> usage = new Dictionary<string, int>();

        if (segments == null)
        {
            return usage;
        }

        for (int i = 0; i < segments.Length; i++)
        {
            SegmentData seg = segments[i];
            if (!IsValidSegment(seg))
            {
                continue;
            }

            string type = string.IsNullOrWhiteSpace(seg.type) ? "wall" : seg.type.Trim().ToLowerInvariant();
            if (!IsWallLikeType(type))
            {
                continue;
            }

            Vector2 start = new Vector2(seg.a.x * gridSize, seg.a.y * gridSize);
            Vector2 end = new Vector2(seg.b.x * gridSize, seg.b.y * gridSize);
            if ((end - start).sqrMagnitude < 0.000001f)
            {
                continue;
            }

            IncrementEndpointUsage(usage, BuildEndpointKey(start));
            IncrementEndpointUsage(usage, BuildEndpointKey(end));
        }

        return usage;
    }

    private bool IsWallLikeType(string type)
    {
        return type == "wall" || type == "halfwall";
    }

    private void IncrementEndpointUsage(Dictionary<string, int> usage, string key)
    {
        if (usage.TryGetValue(key, out int count))
        {
            usage[key] = count + 1;
            return;
        }

        usage[key] = 1;
    }

    private string BuildEndpointKey(Vector2 point)
    {
        int qx = Mathf.RoundToInt(point.x * 1000f);
        int qy = Mathf.RoundToInt(point.y * 1000f);
        return qx.ToString() + ":" + qy.ToString();
    }

    private Quaternion BuildTopViewRotation(Vector3 direction)
    {
        Vector3 flatDirection = new Vector3(direction.x, 0f, direction.z);
        if (flatDirection.sqrMagnitude <= 0.000001f)
        {
            return Quaternion.identity;
        }

        // Unity top view uses XZ plane, with +Z as forward.
        float yaw = Mathf.Atan2(flatDirection.x, flatDirection.z) * Mathf.Rad2Deg;

        return Quaternion.Euler(0f, yaw, 0f);
    }

    private Vector3 BuildScaledLength(Vector3 baseScale, float lineLength)
    {
        float safeBaseLength = Mathf.Max(0.0001f, prefabBaseLength);
        float lengthMultiplier = lineLength / safeBaseLength;

        // Assumes all segment prefabs point forward (+Z) and have the same base length.
        baseScale.z *= lengthMultiplier;

        return baseScale;
    }

    private void SpawnPrefab(GameObject prefab, Vector3 position, Quaternion rotation, Vector3 scale)
    {
        Transform parent = spawnRoot != null ? spawnRoot : transform;
        GameObject instance = Instantiate(prefab, parent);
        Transform instanceTransform = instance.transform;
        instanceTransform.localPosition = position;
        instanceTransform.localRotation = rotation;
        instanceTransform.localScale = scale;
    }

    private float EstimatePrefabHeight(GameObject prefab)
    {
        if (prefab == null)
        {
            return 1f;
        }

        GameObject probe = null;
        try
        {
            probe = Instantiate(prefab);
            probe.hideFlags = HideFlags.HideAndDontSave;

            Renderer[] renderers = probe.GetComponentsInChildren<Renderer>();
            if (renderers == null || renderers.Length == 0)
            {
                return Mathf.Max(0.001f, probe.transform.localScale.y);
            }

            Bounds bounds = renderers[0].bounds;
            for (int i = 1; i < renderers.Length; i++)
            {
                bounds.Encapsulate(renderers[i].bounds);
            }

            return Mathf.Max(0.001f, bounds.size.y);
        }
        finally
        {
            if (probe != null)
            {
#if UNITY_EDITOR
                if (!Application.isPlaying)
                {
                    DestroyImmediate(probe);
                }
                else
                {
                    Destroy(probe);
                }
#else
                Destroy(probe);
#endif
            }
        }
    }

    private float EstimatePrefabThickness(GameObject prefab)
    {
        if (prefab == null)
        {
            return 0f;
        }

        GameObject probe = null;
        try
        {
            probe = Instantiate(prefab);
            probe.hideFlags = HideFlags.HideAndDontSave;

            Renderer[] renderers = probe.GetComponentsInChildren<Renderer>();
            if (renderers == null || renderers.Length == 0)
            {
                return Mathf.Max(0f, probe.transform.localScale.x);
            }

            Bounds bounds = renderers[0].bounds;
            for (int i = 1; i < renderers.Length; i++)
            {
                bounds.Encapsulate(renderers[i].bounds);
            }

            // In top-view XZ generation with +Z forward, thickness maps to local/world X width.
            return Mathf.Max(0f, bounds.size.x);
        }
        finally
        {
            if (probe != null)
            {
#if UNITY_EDITOR
                if (!Application.isPlaying)
                {
                    DestroyImmediate(probe);
                }
                else
                {
                    Destroy(probe);
                }
#else
                Destroy(probe);
#endif
            }
        }
    }

    private bool IsValidSegment(SegmentData seg)
    {
        return seg != null && seg.a != null && seg.b != null;
    }

    private void ClearSpawned()
    {
        Transform parent = spawnRoot != null ? spawnRoot : transform;

        for (int i = parent.childCount - 1; i >= 0; i--)
        {
            Transform child = parent.GetChild(i);

#if UNITY_EDITOR
            if (!Application.isPlaying)
            {
                DestroyImmediate(child.gameObject);
            }
            else
            {
                Destroy(child.gameObject);
            }
#else
            Destroy(child.gameObject);
#endif
        }
    }
}
