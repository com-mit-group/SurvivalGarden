namespace SurvivalGarden.Maui;

public sealed class App(MainPage mainPage) : Microsoft.Maui.Controls.Application
{
    protected override Window CreateWindow(IActivationState? activationState)
    {
        return new Window(mainPage);
    }
}
