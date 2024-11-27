# Tools that can be used to create SNR files

require 'stringio'
require './utils.rb'

HALFWIDTH = '｢｣ｧｨｩｪｫｬｭｮｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝｰｯ､ﾟﾞ･?｡'
HALFWIDTH_REPLACE = '「」ぁぃぅぇぉゃゅょあいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんーっ、？！…　。'

SHIFT_JIS_REVERSE_MAPPINGS = {
  "e2 85 a1" => "\x87\x55",
  "e2 85 a2" => "\x87\x56",
  "e2 85 a3" => "\x87\x57",
  "ee 84 90" => "\xa0", # convert our private use character to Entergram's actual compact half width space
}

class StringIO
  # Write length delimited SHIFT_JIS
  def write_str(str)
    converted = KalSNRFile.to_shift_jis(str)
    write([converted.bytes.length].pack('S<'))
    write(converted.bytes.pack('C*'))
  end
end

class KalSNRFile
  FILESIZE_LOCATION = 0x04
  DIALOGUE_LINE_COUNT_LOCATION = 0x08
  VAL1_LOCATION = 0x0c
  VAL2_LOCATION = 0x10
  VAL3_LOCATION = 0x14
  VAL4_LOCATION = 0x18
  VAL5_LOCATION = 0x1c
  SCRIPT_OFFSET_LOCATION = 0x20
  MASK_OFFSET_LOCATION = 0x24
  BG_OFFSET_LOCATION = 0x28
  BUSTUP_OFFSET_LOCATION = 0x2c
  BGM_OFFSET_LOCATION = 0x30
  SE_OFFSET_LOCATION = 0x34
  MOVIE_OFFSET_LOCATION = 0x38
  VOICE_OFFSET_LOCATION = 0x3c
  TABLE8_OFFSET_LOCATION = 0x40
  TABLE9_OFFSET_LOCATION = 0x44
  OFFSET10_LOCATION = 0x48
  CHARACTERS_OFFSET_LOCATION = 0x4c
  OFFSET12_LOCATION = 0x50
  TIPS_OFFSET_LOCATION = 0x54

  SCRIPT_MAGIC = 0xb00246

  def initialize
    @mode = :kal
    @tables = {}
    @masks, @bgs, @bustups, @bgms, @ses, @movies, @voices, @table8, @table9, @characters, @tips = [], [], [], [], [], [], [], [], [], [], []
  end

  attr_accessor :mode

  def data
    {
      mode: @mode,
      tables: @tables,
      script: @script,
      dialogueLineCount: @dialogue_line_count
    }
  end

  def mask(*v)
    index = @masks.length
    @masks << v
    index
  end

  def write_masks
    @tables[:masks] = write_table(@masks) do |s, mask|
      name, _ = mask
      s.write_str(name)
    end
  end

  def bg(*v)
    index = @bgs.length
    @bgs << v
    index
  end

  def write_bgs
    @tables[:bgs] = write_table(@bgs) do |s, bg|
      name, val1 = bg
      s.write_str(name)
      s.write([val1].pack('S<'))
    end
  end

  def bustup(*v)
    index = @bustups.length
    @bustups << v
    index
  end

  def write_bustups
    @tables[:bustups] = write_table(@bustups) do |s, bustup|
      if @mode == :saku
        name, expr, val1 = bustup
        s.write_str(name)
        s.write_str(expr)
        s.write([val1].pack('S<'))
      else
        name, val1, val2, val3, val4 = bustup
        s.write_str(name)
        s.write([val1, val2, val3, val4].pack('S<S<S<s<'))
      end
    end
  end

  def bgm(*v)
    index = @bgms.length
    @bgms << v
    index
  end

  def write_bgms
    @tables[:bgms] = @bgms
  end

  def se(*v)
    index = @ses.length
    @ses << v
    index
  end

  def write_ses
    @tables[:ses] = write_table(@ses) do |s, se|
      name, _ = se
      s.write_str(name)
    end
  end

  def movie(*v)
    index = @movies.length
    @movies << v
    index
  end

  def write_movies
    @tables[:movies] = write_table(@movies) do |s, movie|
      name, val1, val2, val3 = movie
      s.write_str(name)
      s.write([val1, val2, val3].pack('S<S<S<'))
    end
  end

  def voice(*v)
    index = @voices.length
    @voices << v
    index
  end

  def write_voices
    @tables[:voices] = write_table(@voices) do |s, voice|
      name, *vals = voice
      s.write_str(name)
      s.write(vals.pack('C*'))
    end
  end

  def table8_entry(*v)
    index = @table8.length
    @table8 << v
    index
  end

  def write_table8
    @tables[:table8] = write_table(@table8, size_prefix = false) do |s, entry|
      name, *data = entry
      s.write_str(name)
      s.write([data.length].pack('S<'))
      s.write(data.pack('S<' * data.length))
    end
  end

  def table9_entry(*v)
    index = @table9.length
    @table9 << v
    index
  end

  def write_table9
    @tables[:table9] = write_table(@table9, size_prefix = false) do |s, entry|
      val1, val2, val3 = entry
      s.write([val1, val2, val3].pack('S<S<S<'))
    end
  end

  def write_offset10_data(data)
    @tables[:offset10] = write_size_prefixed_data(data)
  end

  def character(*v)
    index = @characters.length
    @characters << v
    index
  end

  def write_characters
    @tables[:characters] = write_table(@characters) do |s, character|
      val1, segments = character

      s.write([val1].pack('C'))

      segments.each do |segment|
        segment.each do |e|
          if e.is_a? Numeric
            s.write([e].pack('C'))
          elsif e.is_a? String
            s.write_str(e)
          else
            raise "Invalid type of element in segment"
          end
        end
      end

      s.write("\x00")
    end
  end

  def write_offset12_data(data)
    @tables[:offset12] = write_size_prefixed_data(data)
  end

  def tip(*v)
    index = @tips.length
    @tips << v
    index
  end

  def write_tips
    @tables[:tips] = write_table(@tips) do |s, tip|
      val1, val2, name, content = tip
      s.write([val1, val2].pack('CS<'))
      s.write_str(name)
      s.write_str(content)
    end
  end

  def write_size_prefixed_data(data)
    [data.length].pack('L<').unpack('C*') + data
  end

  def write_script(script_data, entry_point, dialogue_line_count)
    @script = [[SCRIPT_MAGIC].pack('L<').unpack('C*'), { type: :ref, name: entry_point }]
    @script += script_data
    @dialogue_line_count = dialogue_line_count
  end

  def write_table(table, size_prefix = true)
    result = StringIO.new
    result.seek(size_prefix ? 4 : 0)
    result.write([table.length].pack('L<'))
    table.each do |entry|
      yield result, entry
    end

    if size_prefix
      result.seek(0)
      result.write([result.length - 4].pack('L<'))
    end

    result.string.unpack('C*')
  end

  def self.to_shift_jis(str)
    converter = Encoding::Converter.new('UTF-8', 'SHIFT_JIS', invalid: :replace)
    converted = Utils::convert_with_mappings(converter, str, SHIFT_JIS_REVERSE_MAPPINGS, 'SHIFT_JIS') + "\x00"
    converted
  end

  # The script calls this but we don't care about this anymore
  def current_offset
    0
  end
end

Register = Struct.new(:id)
Parameter = Struct.new(:value)

Raw = Struct.new(:str)
BMN = Struct.new(:args)

def raw_pack(val, paradigm); Raw.new([val].pack(paradigm)); end
def byte(val); raw_pack(val, 'C'); end
def short(val); raw_pack(val, 's<'); end
def ushort(val); raw_pack(val, 'S<'); end
def int(val); raw_pack(val, 'l<'); end
def uint(val); raw_pack(val, 'L<'); end

def uint24(val)
  packed = [val & 0xffff, val >> 16].pack('S<C')
  Raw.new(packed)
end

def bmn(**args); BMN.new(args); end

class KalScript
  def initialize(_)
    @data = StringIO.new
    @data.binmode

    # The data that will be written to JSON
    @out = []

    @dialogue_line_count = 0
  end

  attr_reader :dialogue_line_count

  # The layouter (unused)
  attr_accessor :layouter

  def data
    push
    @out
  end

  def layout(text)
    # Skip layouting, we are going to do it in JS
    text
  end

  def label(name)
    raise "Label can not be :null" if name == :null
    push
    @out << { type: :label, name: name }
    name
  end

  def ins(opcode, *data)
    if opcode == 0x86
      @dialogue_line_count += 1
      puts "Dialogue ##{@dialogue_line_count}" if @dialogue_line_count % 100 == 0
      push
      @out << {
        type: :dialogue,
        header: data[0..2].map(&:str).join.unpack('C*'),
        id: (data[0..1].map(&:str).join + "\0").unpack('L<').first,
        text: data[3],
      }
      return
    end

    @data.write([opcode].pack('C'))
    data.each do |e|
      if e.is_a? Raw
        @data.write(e.str)
      elsif e.is_a? String
        @data.write_str(e)
      elsif e.is_a? Array
        @data.write([e.length].pack('C'))
        e.each { |f| write_varlen(f) }
      elsif e.is_a? BMN
        write_bmn(e)
      else
        write_varlen(e)
      end
    end
  end

  def write_varlen(e)
    if e.is_a? Integer
      write_varlen_const(e)
    elsif e.is_a? Register
      reg = e.id
      if reg >= 0x10
        @data.write([0xc0, reg].pack('CC'))
      else
        @data.write([0xb0 + reg].pack('C'))
      end
    elsif e.is_a? Parameter
      wrote = @data.write([0xd0 + e.value].pack('C'))
    elsif e == :null
      @data.write("\xe0")
    elsif e.is_a? Symbol # label
      push
      @out << { type: :ref, name: e }
    else
      raise "Invalid varlen: #{e}"
    end
  end

  def write_varlen_const(e)
    if e <= 0x3f && e >= -0x40
      if e >= 0
        @data.write([e].pack('C'))
      else
        @data.write([e + 0x80].pack('C'))
      end
    elsif e <= 0x7ff && e >= -0x800
      if e >= 0
        @data.write([0x80 | ((e & 0x700) >> 8), e & 0xff].pack('CC'))
      else
        shifted = e + 0x1000
        @data.write([0x80 | ((shifted & 0xf00) >> 8), shifted & 0xff].pack('CC'))
      end
    elsif e <= 0x7ffff && e >= -0x80000
      if e >= 0
        @data.write([0x90 | ((e & 0x70000) >> 16), ((e & 0xff00) >> 8), e & 0xff].pack('CCC'))
      else
        shifted = e + 0x100000
        @data.write([0x90 | ((shifted & 0xf0000) >> 16), ((shifted & 0xff00) >> 8), shifted & 0xff].pack('CCC'))
      end
    else
      raise "Varlen const #{e} too big or too small"
    end
  end

  def write_bmn(e)
    varlens = []
    bitmask = 0
    e.args.sort_by(&:first).each do |k, v|
      bitmask |= (1 << k)
      varlens << v
    end

    @data.write([bitmask].pack('C'))
    varlens.each { |v| write_varlen(v) }
  end

  def push
    @out << @data.string.unpack('C*') unless @data.size == 0
    @data.truncate(0)
    @data.rewind
  end
end
