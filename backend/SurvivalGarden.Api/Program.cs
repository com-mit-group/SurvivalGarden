using SurvivalGarden.Api.Endpoints;
using SurvivalGarden.Application;
using SurvivalGarden.Persistence;
using Microsoft.OpenApi.Any;
using Microsoft.OpenApi.Models;

var builder = WebApplication.CreateBuilder(args);

var contractVersion = builder.Configuration["Contracts:Version"] ?? "1.0.0";
var persistedSchemaVersion = builder.Configuration.GetValue<int?>("Contracts:PersistedSchemaVersion") ?? 2;

builder.Services.AddOpenApi(options =>
{
    options.AddDocumentTransformer((document, _, _) =>
    {
        document.Info ??= new OpenApiInfo();
        document.Info.Title = "SurvivalGarden.Api";
        document.Info.Version = contractVersion;
        document.Extensions["x-contracts"] = new OpenApiString("backend-canonical");
        document.Extensions["x-persisted-schema-version"] = new OpenApiInteger(persistedSchemaVersion);
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
app.MapBatchEndpoints();
app.MapDomainOperationEndpoints();

await app.RunAsync();
