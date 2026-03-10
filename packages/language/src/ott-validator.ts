import type { ValidationAcceptor, ValidationChecks } from 'langium';
import type { OttAstType, Person } from './generated/ast.js';
import type { OttServices } from './ott-module.js';

/**
 * Register custom validation checks.
 */
export function registerValidationChecks(services: OttServices) {
    const registry = services.validation.ValidationRegistry;
    const validator = services.validation.OttValidator;
    const checks: ValidationChecks<OttAstType> = {
        Person: validator.checkPersonStartsWithCapital
    };
    registry.register(checks, validator);
}

/**
 * Implementation of custom validations.
 */
export class OttValidator {

    checkPersonStartsWithCapital(person: Person, accept: ValidationAcceptor): void {
        if (person.name) {
            const firstChar = person.name.substring(0, 1);
            if (firstChar.toUpperCase() !== firstChar) {
                accept('warning', 'Person name should start with a capital.', { node: person, property: 'name' });
            }
        }
    }

}
