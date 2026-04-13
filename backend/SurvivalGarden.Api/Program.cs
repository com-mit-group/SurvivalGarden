using SurvivalGarden.Api.Endpoints;
using SurvivalGarden.Application;
using SurvivalGarden.Persistence;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();
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

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

if (corsOrigins.Length > 0)
{
    app.UseCors("Frontend");
}

app.MapCoreEndpoints();
app.MapBatchEndpoints();
app.MapDomainOperationEndpoints();

await app.RunAsync();
