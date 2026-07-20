import { DemoAuthService, type AuthService } from "./auth";
import {
  AdapterDemoRepository,
  LocalDemoDataAdapter,
  type DemoDataAdapter,
  type DemoEntity,
  type DemoRepository,
} from "./demo";
import { createDemoPricingProviders, PricingService } from "./pricing";

export interface DemoServices {
  data: DemoDataAdapter;
  auth: AuthService;
  pricing: PricingService;
  repository<T extends DemoEntity>(collectionKey: string): DemoRepository<T>;
}

export interface CreateDemoServicesOptions {
  dataAdapter?: DemoDataAdapter;
}

/** Creates an isolated service graph; callers control when browser state is shared. */
export function createDemoServices(options: CreateDemoServicesOptions = {}): DemoServices {
  const data = options.dataAdapter ?? new LocalDemoDataAdapter();
  return {
    data,
    auth: new DemoAuthService(data),
    pricing: new PricingService(createDemoPricingProviders()),
    repository: <T extends DemoEntity>(collectionKey: string) =>
      new AdapterDemoRepository<T>(data, collectionKey),
  };
}

