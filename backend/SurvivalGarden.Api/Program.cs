using SurvivalGarden.Api.Endpoints;
using SurvivalGarden.Application;
using SurvivalGarden.Persistence;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();
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

app.MapCoreEndpoints();
app.MapBatchEndpoints();
app.MapDomainOperationEndpoints();

await app.RunAsync();
