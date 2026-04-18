using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

[CustomEditor(typeof(PlanJsonCubeSpawner))]
public class PlanJsonCubeSpawnerEditor : Editor
{
    public override void OnInspectorGUI()
    {
        DrawDefaultInspector();

        GUILayout.Space(8f);

        PlanJsonCubeSpawner spawner = (PlanJsonCubeSpawner)target;

        GUI.backgroundColor = new Color(0.2f, 0.7f, 0.3f);
        if (GUILayout.Button("Build Cubes From JSON (Edit Mode)", GUILayout.Height(30f)))
        {
            Undo.RegisterFullObjectHierarchyUndo(spawner.gameObject, "Build Cubes From JSON");
            spawner.BuildFromAssignedJson();

            if (!Application.isPlaying)
            {
                EditorSceneManager.MarkSceneDirty(spawner.gameObject.scene);
            }
        }
        GUI.backgroundColor = Color.white;
    }
}
