using Microsoft.Maui.Controls;
using Microsoft.Maui.Controls.Shapes;
using Microsoft.Maui.Graphics;

namespace SurvivalGarden.Maui;

public sealed class MainPage : ContentPage
{
    private static readonly Color Forest = Color.FromArgb("#173B2B");
    private static readonly Color Leaf = Color.FromArgb("#2F7650");
    private static readonly Color Mint = Color.FromArgb("#DDF2E5");
    private static readonly Color Canvas = Color.FromArgb("#F4F6F1");
    private static readonly Color Ink = Color.FromArgb("#17231D");
    private static readonly Color Muted = Color.FromArgb("#66736B");
    private static readonly Color Line = Color.FromArgb("#DDE5DD");

    private static readonly SectionDefinition[] Sections =
    [
        new("beds", "Beds", "BE"),
        new("calendar", "Calendar", "CA"),
        new("admin", "Admin", "AD"),
        new("batches", "Batches", "BA"),
        new("nutrition", "Nutrition", "NU"),
        new("seeds", "Seeds", "SE"),
        new("data", "Data", "DA")
    ];

    private readonly ILocalGardenBackend _backend;
    private readonly ContentView _sectionHost;
    private readonly Label _connectionLabel;
    private readonly Label _syncLabel;
    private readonly ActivityIndicator _activityIndicator;
    private readonly Dictionary<string, Button> _navigationButtons = new(StringComparer.Ordinal);

    private LocalGardenSnapshot? _snapshot;
    private string _selectedSection = "beds";
    private bool _loaded;

    public MainPage(ILocalGardenBackend backend)
    {
        _backend = backend;
        Title = "SurvivalGarden";
        BackgroundColor = Canvas;

        _connectionLabel = new Label
        {
            Text = ".NET local",
            FontSize = 12,
            FontAttributes = FontAttributes.Bold,
            TextColor = Forest,
            VerticalTextAlignment = TextAlignment.Center
        };

        _syncLabel = new Label
        {
            Text = "Connecting to canonical state",
            FontSize = 12,
            TextColor = Color.FromArgb("#CFE2D6")
        };

        _activityIndicator = new ActivityIndicator
        {
            Color = Color.FromArgb("#F1C96C"),
            IsVisible = false,
            WidthRequest = 24,
            HeightRequest = 24
        };

        _sectionHost = new ContentView
        {
            Content = CreateLoadingState()
        };

        var root = new Grid
        {
            RowDefinitions =
            {
                new RowDefinition(GridLength.Auto),
                new RowDefinition(GridLength.Star),
                new RowDefinition(GridLength.Auto)
            },
            BackgroundColor = Canvas
        };

        root.Add(CreateHeader(), 0, 0);
        root.Add(new ScrollView
        {
            Content = _sectionHost,
            Padding = new Thickness(18, 20, 18, 28)
        }, 0, 1);
        root.Add(CreateNavigation(), 0, 2);

        Content = root;
        UpdateNavigationState();
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();

        if (_loaded)
        {
            return;
        }

        _loaded = true;
        await RefreshAsync();
    }

    private View CreateHeader()
    {
        var titleBlock = new VerticalStackLayout
        {
            Spacing = 4,
            Children =
            {
                new Label
                {
                    Text = "SurvivalGarden",
                    FontSize = 25,
                    FontAttributes = FontAttributes.Bold,
                    TextColor = Colors.White
                },
                new Label
                {
                    Text = "Plan, grow, and track the garden from one local-first workspace.",
                    FontSize = 13,
                    TextColor = Color.FromArgb("#D7E5DC")
                }
            }
        };

        var statusChip = new Border
        {
            BackgroundColor = Mint,
            StrokeThickness = 0,
            Padding = new Thickness(10, 5),
            StrokeShape = new RoundRectangle { CornerRadius = 16 },
            Content = _connectionLabel
        };

        var refreshButton = new Button
        {
            Text = "Refresh",
            FontSize = 13,
            FontAttributes = FontAttributes.Bold,
            TextColor = Forest,
            BackgroundColor = Color.FromArgb("#F1C96C"),
            CornerRadius = 18,
            HeightRequest = 38,
            Padding = new Thickness(16, 0)
        };
        refreshButton.Clicked += async (_, _) => await RefreshAsync();

        var actions = new HorizontalStackLayout
        {
            Spacing = 10,
            VerticalOptions = LayoutOptions.Center,
            Children = { _activityIndicator, statusChip, refreshButton }
        };

        var headerGrid = new Grid
        {
            ColumnDefinitions =
            {
                new ColumnDefinition(GridLength.Star),
                new ColumnDefinition(GridLength.Auto)
            },
            ColumnSpacing = 18
        };
        headerGrid.Add(titleBlock, 0, 0);
        headerGrid.Add(actions, 1, 0);

        var headerContent = new VerticalStackLayout
        {
            Spacing = 12,
            Children = { headerGrid, _syncLabel }
        };

        return new Border
        {
            BackgroundColor = Forest,
            StrokeThickness = 0,
            Padding = new Thickness(20, 18),
            Content = headerContent
        };
    }

    private View CreateNavigation()
    {
        var navigation = new HorizontalStackLayout
        {
            Spacing = 8,
            Padding = new Thickness(10, 9)
        };

        foreach (var section in Sections)
        {
            var button = new Button
            {
                Text = $"{section.Badge}  {section.Label}",
                FontSize = 13,
                FontAttributes = FontAttributes.Bold,
                CornerRadius = 18,
                HeightRequest = 42,
                Padding = new Thickness(15, 0),
                MinimumWidthRequest = 94
            };
            button.Clicked += (_, _) => SelectSection(section.Key);
            _navigationButtons[section.Key] = button;
            navigation.Children.Add(button);
        }

        return new Border
        {
            BackgroundColor = Colors.White,
            Stroke = Line,
            StrokeThickness = 1,
            Padding = 0,
            Content = new ScrollView
            {
                Orientation = ScrollOrientation.Horizontal,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Never,
                Content = navigation
            }
        };
    }

    private async Task RefreshAsync()
    {
        _activityIndicator.IsVisible = true;
        _activityIndicator.IsRunning = true;
        _syncLabel.Text = "Reading canonical state through the local backend service...";

        try
        {
            _snapshot = await _backend.LoadSnapshotAsync();
            _connectionLabel.Text = _snapshot.HasState ? ".NET local - ready" : ".NET local - empty";
            _syncLabel.Text = _snapshot.HasState
                ? $"{_snapshot.EntityCount} records loaded at {_snapshot.LoadedAt:t}. Backend responses remain authoritative."
                : "Local backend ready. Add or import garden data to populate this workspace.";
            RenderSelectedSection();
        }
        catch (Exception exception)
        {
            _connectionLabel.Text = ".NET local - unavailable";
            _syncLabel.Text = "The local backend could not load canonical state.";
            _sectionHost.Content = CreateErrorState(exception.Message);
        }
        finally
        {
            _activityIndicator.IsRunning = false;
            _activityIndicator.IsVisible = false;
        }
    }

    private void SelectSection(string sectionKey)
    {
        _selectedSection = sectionKey;
        UpdateNavigationState();
        RenderSelectedSection();
    }

    private void UpdateNavigationState()
    {
        foreach (var (key, button) in _navigationButtons)
        {
            var isSelected = string.Equals(key, _selectedSection, StringComparison.Ordinal);
            button.BackgroundColor = isSelected ? Leaf : Color.FromArgb("#EEF3EE");
            button.TextColor = isSelected ? Colors.White : Forest;
        }
    }

    private void RenderSelectedSection()
    {
        if (_snapshot is null)
        {
            _sectionHost.Content = CreateLoadingState();
            return;
        }

        _sectionHost.Content = _selectedSection switch
        {
            "beds" => BuildBedsPage(_snapshot),
            "calendar" => BuildCalendarPage(_snapshot),
            "admin" => BuildAdminPage(_snapshot),
            "batches" => BuildBatchesPage(_snapshot),
            "nutrition" => BuildNutritionPage(_snapshot),
            "seeds" => BuildSeedsPage(_snapshot),
            "data" => BuildDataPage(_snapshot),
            _ => BuildBedsPage(_snapshot)
        };
    }

    private static View BuildBedsPage(LocalGardenSnapshot snapshot)
    {
        var beds = snapshot.GetCollection("beds");
        var segments = snapshot.GetCollection("segments");
        var batches = snapshot.GetCollection("batches");

        return BuildPage(
            "Garden layout",
            "Beds and growing areas, organized from the same canonical state used by the backend.",
            CreateMetricStrip(("Beds", beds.Count), ("Segments", segments.Count), ("Batches", batches.Count)),
            CreateRecordSection("Beds", beds, "No beds have been configured yet."));
    }

    private static View BuildCalendarPage(LocalGardenSnapshot snapshot)
    {
        var tasks = snapshot.GetCollection("tasks");
        var plans = snapshot.GetCollection("cropPlans");

        return BuildPage(
            "Calendar",
            "Upcoming garden work and crop planning milestones.",
            CreateMetricStrip(("Tasks", tasks.Count), ("Crop plans", plans.Count), ("Open batches", snapshot.GetCollection("batches").Count)),
            CreateRecordSection("Garden tasks", tasks, "No calendar tasks are currently available."));
    }

    private static View BuildAdminPage(LocalGardenSnapshot snapshot)
    {
        var species = snapshot.GetCollection("species");
        var crops = snapshot.GetCollection("crops");
        var cultivars = snapshot.GetCollection("cultivars");

        return BuildPage(
            "Admin and taxonomy",
            "Manage the reference data that identifies crops and cultivars across the garden.",
            CreateMetricStrip(("Species", species.Count), ("Crop types", crops.Count), ("Cultivars", cultivars.Count)),
            CreateRecordSection("Species", species, "No species records are available.", 4),
            CreateRecordSection("Crop types", crops, "No crop types are available.", 4),
            CreateRecordSection("Cultivars", cultivars, "No cultivars are available.", 4));
    }

    private static View BuildBatchesPage(LocalGardenSnapshot snapshot)
    {
        var batches = snapshot.GetCollection("batches");

        return BuildPage(
            "Batches",
            "Track each planting from its starting method through the current growth stage.",
            CreateMetricStrip(("All batches", batches.Count), ("Beds", snapshot.GetCollection("beds").Count), ("Cultivars", snapshot.GetCollection("cultivars").Count)),
            CreateRecordSection("Planting batches", batches, "No planting batches have been started."));
    }

    private static View BuildNutritionPage(LocalGardenSnapshot snapshot)
    {
        var plans = snapshot.GetCollection("cropPlans");
        var crops = snapshot.GetCollection("crops");

        return BuildPage(
            "Nutrition planning",
            "Use crop plans and active batches to understand what the garden is preparing to produce.",
            CreateMetricStrip(("Crop plans", plans.Count), ("Crop types", crops.Count), ("Active records", snapshot.EntityCount)),
            CreateCallout("Backend-authoritative planning", "Nutrition projections stay tied to canonical crop plans and planting data instead of duplicating garden rules in the UI."),
            CreateRecordSection("Crop plans", plans, "No crop plans are available."));
    }

    private static View BuildSeedsPage(LocalGardenSnapshot snapshot)
    {
        var seeds = snapshot.GetCollection("seedInventoryItems");

        return BuildPage(
            "Seed inventory",
            "A clear view of locally stored seed inventory and cultivar references.",
            CreateMetricStrip(("Inventory items", seeds.Count), ("Cultivars", snapshot.GetCollection("cultivars").Count), ("Species", snapshot.GetCollection("species").Count)),
            CreateRecordSection("Seeds", seeds, "No seed inventory items are available."));
    }

    private static View BuildDataPage(LocalGardenSnapshot snapshot)
    {
        var collectionRows = snapshot.Collections
            .OrderBy(entry => entry.Key, StringComparer.Ordinal)
            .Select(entry => new GardenRecordSummary(entry.Key, Humanize(entry.Key), $"{entry.Value.Count} records", "Stored in the MAUI app-data location"))
            .ToArray();

        return BuildPage(
            "Local data",
            "Storage health and canonical collection counts for this device.",
            CreateMetricStrip(("Collections", snapshot.Collections.Count), ("Records", snapshot.EntityCount), ("Transport calls", 0)),
            CreateCallout("Local service boundary", "MAUI resolves application and persistence services directly through dependency injection. No network transport or embedded web server is used."),
            CreateRecordSection("Canonical collections", collectionRows, "No collections have been initialized."));
    }

    private static View BuildPage(string title, string description, params View[] sections)
    {
        var layout = new VerticalStackLayout
        {
            MaximumWidthRequest = 980,
            HorizontalOptions = LayoutOptions.Center,
            Spacing = 18
        };

        layout.Children.Add(new Label
        {
            Text = title,
            FontSize = 27,
            FontAttributes = FontAttributes.Bold,
            TextColor = Ink
        });
        layout.Children.Add(new Label
        {
            Text = description,
            FontSize = 15,
            TextColor = Muted
        });

        foreach (var section in sections)
        {
            layout.Children.Add(section);
        }

        return layout;
    }

    private static View CreateMetricStrip(params (string Label, int Value)[] metrics)
    {
        var row = new HorizontalStackLayout { Spacing = 12 };

        foreach (var metric in metrics)
        {
            row.Children.Add(new Border
            {
                BackgroundColor = Colors.White,
                Stroke = Line,
                StrokeThickness = 1,
                StrokeShape = new RoundRectangle { CornerRadius = 16 },
                Padding = new Thickness(16, 13),
                MinimumWidthRequest = 145,
                Content = new VerticalStackLayout
                {
                    Spacing = 2,
                    Children =
                    {
                        new Label
                        {
                            Text = metric.Value.ToString(),
                            FontSize = 25,
                            FontAttributes = FontAttributes.Bold,
                            TextColor = Forest
                        },
                        new Label
                        {
                            Text = metric.Label,
                            FontSize = 12,
                            TextColor = Muted
                        }
                    }
                }
            });
        }

        return new ScrollView
        {
            Orientation = ScrollOrientation.Horizontal,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Never,
            Content = row
        };
    }

    private static View CreateRecordSection(string title, IReadOnlyList<GardenRecordSummary> records, string emptyMessage, int limit = 8)
    {
        var section = new VerticalStackLayout { Spacing = 10 };
        section.Children.Add(new Label
        {
            Text = title,
            FontSize = 18,
            FontAttributes = FontAttributes.Bold,
            TextColor = Ink
        });

        if (records.Count == 0)
        {
            section.Children.Add(CreateEmptyCard(emptyMessage));
            return section;
        }

        foreach (var record in records.Take(limit))
        {
            var text = new VerticalStackLayout
            {
                Spacing = 3,
                Children =
                {
                    new Label
                    {
                        Text = record.Title,
                        FontSize = 16,
                        FontAttributes = FontAttributes.Bold,
                        TextColor = Ink
                    },
                    new Label
                    {
                        Text = string.IsNullOrWhiteSpace(record.Subtitle) ? record.Id : record.Subtitle,
                        FontSize = 13,
                        TextColor = Leaf
                    }
                }
            };

            if (!string.IsNullOrWhiteSpace(record.Detail))
            {
                text.Children.Add(new Label
                {
                    Text = record.Detail,
                    FontSize = 12,
                    TextColor = Muted,
                    MaxLines = 2,
                    LineBreakMode = LineBreakMode.TailTruncation
                });
            }

            section.Children.Add(new Border
            {
                BackgroundColor = Colors.White,
                Stroke = Line,
                StrokeThickness = 1,
                StrokeShape = new RoundRectangle { CornerRadius = 16 },
                Padding = new Thickness(16, 14),
                Content = text
            });
        }

        if (records.Count > limit)
        {
            section.Children.Add(new Label
            {
                Text = $"Showing {limit} of {records.Count} records.",
                FontSize = 12,
                TextColor = Muted,
                HorizontalTextAlignment = TextAlignment.End
            });
        }

        return section;
    }

    private static View CreateCallout(string title, string message)
    {
        return new Border
        {
            BackgroundColor = Mint,
            Stroke = Color.FromArgb("#B9DCC6"),
            StrokeThickness = 1,
            StrokeShape = new RoundRectangle { CornerRadius = 16 },
            Padding = new Thickness(16),
            Content = new VerticalStackLayout
            {
                Spacing = 5,
                Children =
                {
                    new Label
                    {
                        Text = title,
                        FontSize = 15,
                        FontAttributes = FontAttributes.Bold,
                        TextColor = Forest
                    },
                    new Label
                    {
                        Text = message,
                        FontSize = 13,
                        TextColor = Color.FromArgb("#355A45")
                    }
                }
            }
        };
    }

    private static View CreateEmptyCard(string message)
    {
        return new Border
        {
            BackgroundColor = Color.FromArgb("#FAFCF9"),
            Stroke = Line,
            StrokeThickness = 1,
            StrokeShape = new RoundRectangle { CornerRadius = 16 },
            Padding = new Thickness(18, 24),
            Content = new Label
            {
                Text = message,
                FontSize = 14,
                TextColor = Muted,
                HorizontalTextAlignment = TextAlignment.Center
            }
        };
    }

    private static View CreateLoadingState()
    {
        return new VerticalStackLayout
        {
            MaximumWidthRequest = 980,
            HorizontalOptions = LayoutOptions.Center,
            Padding = new Thickness(0, 30),
            Spacing = 10,
            Children =
            {
                new Label
                {
                    Text = "Preparing your garden workspace",
                    FontSize = 24,
                    FontAttributes = FontAttributes.Bold,
                    TextColor = Ink,
                    HorizontalTextAlignment = TextAlignment.Center
                },
                new Label
                {
                    Text = "Loading canonical state through the local backend service.",
                    FontSize = 14,
                    TextColor = Muted,
                    HorizontalTextAlignment = TextAlignment.Center
                }
            }
        };
    }

    private static View CreateErrorState(string message)
    {
        return BuildPage(
            "Local data unavailable",
            "The MAUI shell started, but canonical state could not be read.",
            CreateCallout("Load failed", message));
    }

    private static string Humanize(string name)
    {
        return name switch
        {
            "seedInventoryItems" => "Seed inventory",
            "cropPlans" => "Crop plans",
            _ => char.ToUpperInvariant(name[0]) + name[1..]
        };
    }

    private sealed record SectionDefinition(string Key, string Label, string Badge);
}
