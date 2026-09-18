import SwiftUI

struct AuthGateView: View {
    @Environment(AuthService.self) private var auth

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Text("MyTwitter")
                .font(.largeTitle.weight(.bold))
            Text(gateMessage)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .padding(.horizontal)
            if let error = auth.authError, !error.isEmpty {
                Text(error)
                    .font(.subheadline)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }
            Button {
                auth.signIn()
            } label: {
                if auth.isBusy {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else {
                    Text("Sign in with X")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(auth.isBusy)
            .padding(.horizontal, 32)
            Spacer()
        }
        .padding()
    }

    private var gateMessage: String {
        if let invite = auth.pendingInvite, !invite.isEmpty {
            return "You have an invite. Sign in with X to join this private feed."
        }
        return "Sign in with X to view your following feed."
    }
}
