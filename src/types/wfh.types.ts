export interface WFHRequest {
    id?: number;
    userId: number;
    requestDate: string;
    fromDate: string;
    toDate: string;
    reason?: string;
    wfhStatus: 'Pending' | 'Approved' | 'Rejected';
    approvedBy?: number;
    approvedAt?: Date;
    rejectedReason?: string;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface WFHValidationResult {
    allowed: boolean;
    isWFH: boolean;
    message: string;
    code: string;
    distance?: number;
    wfhRequest?: WFHRequest;
    requiresOffice?: boolean;
}