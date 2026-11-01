namespace ArsScenarioEditor
{
    public static class Constants
    {
        public const string ScenarioBackupIdPrefix = "BI.";
        public static class NextStepAction
        {
            public const int Fail = -1;
            public const int Success = 10000;
            public const int Skip = 10001;
            public const int Next = 10002;
        }
    }
}
namespace ArsScenarioEditor.Properties
{
    internal static class StringLib { internal static string Common_NotEntered => "Not entered"; }
}
