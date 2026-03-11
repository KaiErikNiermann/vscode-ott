import type { ValidationAcceptor, ValidationChecks } from 'langium';
import type { OttAstType, RuleSeparator } from './generated/ast.js';
import type { OttServices } from './ott-module.js';

export function registerValidationChecks(services: OttServices) {
    const registry = services.validation.ValidationRegistry;
    const validator = services.validation.OttValidator;
    const checks: ValidationChecks<OttAstType> = {
        RuleSeparator: validator.checkRuleSeparatorHasName,
    };
    registry.register(checks, validator);
}

export class OttValidator {

    checkRuleSeparatorHasName(sep: RuleSeparator, accept: ValidationAcceptor): void {
        if (!sep.name) {
            accept('warning', 'Rule separator should have a name.', { node: sep, property: 'name' });
        }
    }

}
