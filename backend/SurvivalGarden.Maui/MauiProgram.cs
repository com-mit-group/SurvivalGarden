using Microsoft.Extensions.DependencyInjection;
using Microsoft.Maui.Storage;
using SurvivalGarden.Application;
using SurvivalGarden.Persistence;

namespace SurvivalGarden.Maui;

public static class MauiProgram
{
    public static MauiApp CreateMauiApp()
    {
        var builder = MauiApp.CreateBuilder();

        builder
            .UseMauiApp<App>()
            .ConfigureFonts(_ => { });

        var appStatePath = Path.Combine(FileSystem.AppDataDirectory, "app-state.json");
        builder.Services.AddPersistence(appStatePath, "Local");
        builder.Services.AddApplication();
        builder.Services.AddSingleton<ILocalGardenBackend, LocalGardenBackend>();
        builder.Services.AddSingleton<MainPage>();

        return builder.Build();
    }
}
