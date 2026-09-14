import Foundation

enum TweetUrlParser {
    private static let statusIdRegex = try! NSRegularExpression(
        pattern: #"/(?:i/)?(?:web/)?status(?:es)?/(\d+)"#,
        options: .caseInsensitive
    )

    private static let xHosts: Set<String> = [
        "x.com",
        "www.x.com",
        "mobile.x.com",
        "twitter.com",
        "www.twitter.com",
        "mobile.twitter.com",
    ]

    static func isXStatusOrTco(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        if host == "t.co" { return true }
        guard xHosts.contains(host) else { return false }
        let path = url.path
        let range = NSRange(path.startIndex..<path.endIndex, in: path)
        return statusIdRegex.firstMatch(in: path, options: [], range: range) != nil
    }

    static func extractStatusId(_ url: URL) -> String? {
        guard let host = url.host?.lowercased(), xHosts.contains(host) else { return nil }
        let path = url.path
        let range = NSRange(path.startIndex..<path.endIndex, in: path)
        guard let match = statusIdRegex.firstMatch(in: path, options: [], range: range),
              match.numberOfRanges > 1,
              let idRange = Range(match.range(at: 1), in: path)
        else { return nil }
        return String(path[idRange])
    }
}
