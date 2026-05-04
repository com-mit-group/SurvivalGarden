using SurvivalGarden.Api.Endpoints;
using SurvivalGarden.Application;
using SurvivalGarden.Persistence;
using Microsoft.OpenApi;

var builder = WebApplication.CreateBuilder(args);

var contractVersion = builder.Configuration["Contracts:Version"] ?? "1.0.0";
var persistedSchemaVersion = builder.Configuration.GetValue<int?>("Contracts:PersistedSchemaVersion") ?? 2;

builder.Services.AddOpenApi(options =>
{
    options.AddDocumentTransformer((document, _, _) =>
    {
        document.Info ??= new();
        document.Info.Title = "SurvivalGarden.Api";
        document.Info.Version = contractVersion;
        document.Info.Description = $"contracts=backend-canonical;persistedSchemaVersion={persistedSchemaVersion}";
        return Task.CompletedTask;
    });
});
var corsOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
if (builder.Environment.IsDevelopment() && corsOrigins.Length == 0)
{
    corsOrigins = ["http://localhost:5173"];
}

if (corsOrigins.Length > 0)
{
    builder.Services.AddCors(options =>
    {
        options.AddPolicy("Frontend", policy =>
        {
            policy.WithOrigins(corsOrigins)
                .AllowAnyHeader()
                .AllowAnyMethod();
        });
    });
}
var appStatePath =
    builder.Configuration["APP_STATE_FILE_PATH"] ??
    builder.Configuration["Persistence:AppStatePath"];
builder.Services.AddPersistence(appStatePath);
builder.Services.AddApplication();

var app = builder.Build();

app.MapOpenApi();

if (corsOrigins.Length > 0)
{
    app.UseCors("Frontend");
}

app.MapCoreEndpoints();
app.MapSegmentEndpoints();
app.MapBatchEndpoints();
app.MapDomainOperationEndpoints();

await app.RunAsync();

public partial class Program { }
