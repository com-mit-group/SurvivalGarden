using Microsoft.Maui.Controls;
using Microsoft.Maui.Graphics;

namespace SurvivalGarden.Maui;

public sealed class MainPage : ContentPage
{
    private readonly ILocalGardenBackend _backend;
    private readonly Label _statusLabel;
    private bool _loaded;

    public MainPage(ILocalGardenBackend backend)
    {
        _backend = backend;
        Title = "Survival Garden";
        BackgroundColor = Color.FromArgb("#F4F1E8");

        _statusLabel = new Label
        {
            Text = "Loading local garden state...",
            FontSize = 18,
            TextColor = Color.FromArgb("#244A2B")
        };

        Content = new ScrollView
        {
            Content = new VerticalStackLayout
            {
                Padding = new Thickness(28),
                Spacing = 16,
                Children =
                {
                    new Label
                    {
                        Text = "Survival Garden",
                        FontSize = 32,
                        FontAttributes = FontAttributes.Bold,
                        TextColor = Color.FromArgb("#2F6B3B")
                    },
                    new Label
                    {
                        Text = "Local backend service host",
                        FontSize = 14,
                        TextColor = Color.FromArgb("#52604F")
                    },
                    _statusLabel
                }
            }
        };
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();

        if (_loaded)
        {
            return;
        }

        _loaded = true;

        try
        {
            var summary = await _backend.LoadStateSummaryAsync();
            _statusLabel.Text = summary.HasState
                ? $"Local garden state loaded: {summary.EntityCount} records."
                : "Local backend ready. No saved garden state yet.";
        }
        catch (Exception exception)
        {
            _statusLabel.Text = $"Local backend failed to load: {exception.Message}";
        }
    }
}
