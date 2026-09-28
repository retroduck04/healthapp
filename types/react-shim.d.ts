// Minimal type declarations for the parts of React this app uses.
// (@types/react is not available in the build environment.)

declare module "react" {
  export type ReactNode = any;
  export type SetStateAction<S> = S | ((prev: S) => S);
  export type Dispatch<A> = (value: A) => void;
  export function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  export function useCallback<T extends (...args: any[]) => any>(callback: T, deps: readonly unknown[]): T;
  export function useRef<T>(initial: T): { current: T };
  export function useReducer<S, A>(reducer: (s: S, a: A) => S, initial: S): [S, Dispatch<A>];
  export function useSyncExternalStore<T>(subscribe: (cb: () => void) => () => void, getSnapshot: () => T): T;
  export interface Context<T> {
    Provider: (props: { value: T; children?: ReactNode }) => any;
    _t?: T;
  }
  export function createContext<T>(value: T): Context<T>;
  export function useContext<T>(context: Context<T>): T;
  export const Fragment: any;
  export const StrictMode: any;
  const React: any;
  export default React;
}

declare module "react/jsx-runtime" {
  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
  export namespace JSX {
    type Element = any;
    interface IntrinsicElements {
      [name: string]: any;
    }
    interface IntrinsicAttributes {
      key?: string | number | null;
    }
    interface ElementChildrenAttribute {
      children: {};
    }
  }
}

declare module "react-dom/client" {
  export function createRoot(el: Element): { render(node: any): void };
}
