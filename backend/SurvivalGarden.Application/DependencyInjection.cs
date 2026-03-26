using Microsoft.Extensions.DependencyInjection;

namespace SurvivalGarden.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        return services;
    }
}
