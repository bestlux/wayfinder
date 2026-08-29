export class StartingEquipmentCommandBlockedError extends Error {
    publicMessage;
    constructor(message) {
        const publicMessage = message.trim();
        if (!publicMessage)
            throw new TypeError("A starting-equipment command blocker requires a public message.");
        super(publicMessage);
        this.name = "StartingEquipmentCommandBlockedError";
        this.publicMessage = publicMessage;
    }
}
export class StartingEquipmentPhysicalGrantCoverageError extends StartingEquipmentCommandBlockedError {
    blocker;
    blockers;
    constructor(blockers) {
        const blocker = blockers[0];
        if (!blocker)
            throw new TypeError("A physical-grant coverage error requires at least one blocker.");
        super(blocker.message);
        this.name = "StartingEquipmentPhysicalGrantCoverageError";
        this.blocker = Object.freeze({ ...blocker });
        this.blockers = Object.freeze(blockers.map((entry) => Object.freeze({ ...entry })));
    }
}
//# sourceMappingURL=starting-equipment-command-error.js.map