import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught error:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#ecece8',
            color: '#000',
            padding: 24,
            fontFamily: "'Schibsted Grotesk', system-ui, sans-serif",
            textAlign: 'center',
          }}
        >
          <div
            style={{
              maxWidth: 480,
              background: '#fff',
              border: '3px solid #000',
              padding: 24,
              borderRadius: 8,
              boxShadow: '4px 4px 0px #000',
            }}
          >
            <h1
              style={{
                fontSize: 24,
                fontWeight: 900,
                marginBottom: 12,
                color: '#e0202e',
              }}
            >
              MarineEdge Notice
            </h1>
            <p style={{ fontSize: 15, marginBottom: 16, color: '#5d5d58' }}>
              An error occurred while loading this view:
            </p>
            <pre
              style={{
                fontSize: 12,
                background: '#f4f4f0',
                padding: 12,
                borderRadius: 4,
                overflowX: 'auto',
                textAlign: 'left',
                marginBottom: 20,
                border: '1px solid #d9d9d3',
              }}
            >
              {this.state.error?.message || 'Unknown runtime error'}
            </pre>
            <button
              onClick={this.handleReload}
              style={{
                background: '#ffd400',
                color: '#000',
                fontWeight: 700,
                padding: '10px 20px',
                border: '2px solid #000',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              Reload MarineEdge
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
