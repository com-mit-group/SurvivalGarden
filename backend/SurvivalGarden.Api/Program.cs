using SurvivalGarden.Api.Endpoints;
using SurvivalGarden.Application;
using SurvivalGarden.Persistence;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();
builder.Services.AddPersistence(builder.Configuration["Persistence:AppStatePath"]);
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
