using System;
using System.Text;
using Newtonsoft.Json;
using ArsScenarioEditor.DataStruct;

// 표준 입력의 JSON 을 사내 C# 클래스로 읽어 편집기와 같은 설정으로 다시 쓴다(EARSHttpClient.cs:576-581).
class Program
{
    static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        if (args.Length != 1) { Console.Error.WriteLine("usage: <Scenario|BackupInfo|Property> < in.json"); return 2; }
        string input = Console.In.ReadToEnd();
        string output;
        switch (args[0])
        {
            case "Scenario":
                output = JsonConvert.SerializeObject(JsonConvert.DeserializeObject<Scenario>(input), Formatting.None);
                break;
            case "BackupInfo":
                output = JsonConvert.SerializeObject(JsonConvert.DeserializeObject<ScenarioBackupInfo>(input), Formatting.None);
                break;
            case "Property":
                output = JsonConvert.SerializeObject(JsonConvert.DeserializeObject<ScenarioProperty>(input),
                    new JsonSerializerSettings { NullValueHandling = NullValueHandling.Ignore });
                break;
            default:
                Console.Error.WriteLine("unknown type " + args[0]);
                return 2;
        }
        Console.Out.Write(output);
        return 0;
    }
}
