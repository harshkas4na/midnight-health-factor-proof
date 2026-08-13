import type { InitialAPI, ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import {
  firstValueFrom,
  interval,
  map,
  filter,
  take,
  timeout,
  concatMap,
  catchError,
  throwError,
} from 'rxjs';

declare global {
  interface Window {
    midnight?: Record<string, InitialAPI>;
  }
}

export function listWallets(): InitialAPI[] {
  const injected = window.midnight;
  return injected ? Object.values(injected) : [];
}

function getFirstCompatibleWallet(): InitialAPI | undefined {
  return listWallets()[0];
}

export function connectToWallet(networkId: string): Promise<ConnectedAPI> {
  return firstValueFrom(
    interval(100).pipe(
      map(() => getFirstCompatibleWallet()),
      filter((api): api is InitialAPI => !!api),
      take(1),
      timeout({
        first: 5_000,
        with: () =>
          throwError(
            () =>
              new Error(
                'No Midnight wallet found. Install the Lace wallet extension and reload.',
              ),
          ),
      }),
      concatMap((initialAPI) => initialAPI.connect(networkId)),
      timeout({
        first: 10_000,
        with: () =>
          throwError(() => new Error('Lace wallet did not respond to the connection request.')),
      }),
      catchError((error) =>
        throwError(() =>
          error instanceof Error ? error : new Error('Wallet connection was not authorized.'),
        ),
      ),
    ),
  );
}
