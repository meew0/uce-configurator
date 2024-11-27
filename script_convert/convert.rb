require 'digest'
require 'json'
require 'zlib'
require_relative 'scenario.rb'

if ARGV[0].nil?
  puts 'Please specify an output path'
  exit
end

if !File.exist?('script.rb') || Digest::SHA256.hexdigest(File.read('script.rb')) != 'f6e6489f6ce48fca424f2824f56c11c5a148766bd89ff6bf155a8f872496d291'
  puts 'script.rb missing or invalid! Please place the script.rb of UCE commit fc39b37 in the current folder.'
  exit
end

def require_relative(_)
end

class WordWrapLayouter
  def initialize(_, _)
  end

  def layout(str)
    LayoutedString.new(str)
  end
end

snr = KalSNRFile.new

load 'script.rb'
raw_apply(snr)

File.write(ARGV[0], JSON.generate(snr.data));
Zlib::GzipWriter.open(ARGV[0] + '.gz') do |gz|
  gz.write(JSON.generate(snr.data))
end
