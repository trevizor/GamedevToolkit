using System;
using UnityEngine;

public class PlanJsonCubeSpawner : MonoBehaviour
{
    [Header("Input")]
    [SerializeField] private TextAsset planJsonFile;

    [Header("Prefabs By Line Type")]
    [SerializeField] private GameObject wallPrefab;
    [SerializeField] private GameObject halfWallPrefab;
    [SerializeField] private GameObject doorPrefab;
    [SerializeField] private GameObject windowPrefab;
    [SerializeField] private GameObject fakeWallPrefab;

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
        public float windowGap;
    }

    [Serializable]
    private class FloorData
    {
        public string name;
        public SegmentData[] segments;
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

        int spawnedCount = 0;

        if (plan.floors != null && plan.floors.Length > 0)
        {
            float floorStride = wallPrefabHeight;
            for (int i = 0; i < plan.floors.Length; i++)
            {
                SegmentData[] segments = plan.floors[i] != null ? plan.floors[i].segments : null;
                if (segments == null || segments.Length == 0)
                {
                    continue;
                }

                float levelBaseY = i * floorStride;
                spawnedCount += SpawnSegments(segments, levelBaseY, grid);
            }
        }
        else if (plan.segments != null && plan.segments.Length > 0)
        {
            spawnedCount += SpawnSegments(plan.segments, 0f, grid);
        }
        else
        {
            Debug.LogWarning("PlanJsonCubeSpawner: No segments found in JSON.", this);
        }

        if (logBuildSummary)
        {
            Debug.Log($"PlanJsonCubeSpawner: Spawn complete. Cubes spawned: {spawnedCount}", this);
        }
    }

    private int SpawnSegments(
        SegmentData[] segments,
        float levelBaseY,
        float gridSize)
    {
        int count = 0;

        for (int i = 0; i < segments.Length; i++)
        {
            SegmentData seg = segments[i];
            if (!IsValidSegment(seg))
            {
                continue;
            }

            string type = string.IsNullOrWhiteSpace(seg.type) ? "wall" : seg.type.Trim().ToLowerInvariant();
            if (type == "fakewall")
            {
                continue;
            }

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

            SpawnSegmentPrefab(prefab, start, end, levelBaseY);
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
            case "fakewall":
                return fakeWallPrefab != null ? fakeWallPrefab : wallPrefab;
            default:
                return wallPrefab;
        }
    }

    private void SpawnSegmentPrefab(GameObject prefab, Vector2 start, Vector2 end, float levelBaseY)
    {
        Vector2 delta = end - start;
        float len = delta.magnitude;
        if (len <= 0.0001f)
        {
            return;
        }

        Vector3 worldPos = new Vector3(start.x, levelBaseY, start.y);
        Vector3 dir3 = new Vector3(delta.x / len, 0f, delta.y / len);
        Quaternion rot = BuildTopViewRotation(dir3);
        Vector3 scale = BuildScaledLength(prefab.transform.localScale, len);

        SpawnPrefab(prefab, worldPos, rot, scale);
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
