export type PasswordRequirement = { label: string; met: boolean }

export function passwordRequirements(password: string): PasswordRequirement[] {
    return [
        { label: "At least 12 characters", met: password.length >= 12 },
        { label: "One uppercase and one lowercase letter", met: /[A-Z]/.test(password) && /[a-z]/.test(password) },
        { label: "One number or symbol", met: /[^A-Za-z]/.test(password) },
    ]
}
