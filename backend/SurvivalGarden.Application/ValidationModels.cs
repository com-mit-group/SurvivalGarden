namespace SurvivalGarden.Application;

public sealed record ValidationIssue(string Path, string Message);

public sealed record ValidationResult(bool Ok, IReadOnlyList<ValidationIssue> Issues)
{
    public static ValidationResult Success() => new(true, []);
    public static ValidationResult Failure(params ValidationIssue[] issues) => new(false, issues);
}
